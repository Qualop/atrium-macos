import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { findExecutable } from './platform.mjs';

const CLI = '@google/gemini-cli';
const CORE = '@google/gemini-cli-core';
const validId = (id) => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,511}$/.test(id) && id !== 'none';
const fallbackModels = () => [{ id: 'auto', name: 'Auto' }];

// A deliberately small data-only reader. Unknown expressions fail closed;
// installed JS is never imported, evaluated, or run (even --help reads profile).
function readLiteral(text, start = 0, constants = {}) {
  let at = start;
  const skip = () => {
    const match = /^(?:\s|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/.exec(text.slice(at));
    at += match[0].length;
  };
  const take = (wanted) => { skip(); if (text[at] !== wanted) throw new Error('Unsupported model metadata'); at++; };
  const read = (depth = 0) => {
    if (depth > 20) throw new Error('Model metadata too deep');
    skip();
    const c = text[at];
    if (c === '"' || c === "'") {
      const quote = text[at++];
      let value = '';
      while (at < text.length) {
        const next = text[at++];
        if (next === quote) return value;
        if (next !== '\\') { value += next; continue; }
        const escaped = text[at++];
        const escapes = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', '0': '\0' };
        if (escaped === 'u' || escaped === 'x') {
          const size = escaped === 'u' ? 4 : 2;
          const hex = text.slice(at, at + size);
          if (!new RegExp(`^[0-9a-fA-F]{${size}}$`).test(hex)) throw new Error('Invalid escape');
          value += String.fromCharCode(parseInt(hex, 16)); at += size;
        } else value += escapes[escaped] ?? escaped;
      }
      throw new Error('Unclosed model metadata string');
    }
    if (c === '{' || c === '[') {
      at++;
      const object = c === '{', end = object ? '}' : ']';
      const value = object ? Object.create(null) : [];
      skip();
      while (text[at] !== end) {
        let key;
        if (object) {
          if (text[at] === '[') { at++; key = read(depth + 1); take(']'); }
          else if (text[at] === '"' || text[at] === "'") key = read(depth + 1);
          else { const match = /^[A-Za-z_$][\w$]*/.exec(text.slice(at)); if (!match) throw new Error('Invalid key'); key = match[0]; at += key.length; }
          take(':');
        }
        const item = read(depth + 1);
        if (object) value[key] = item; else value.push(item);
        skip();
        if (text[at] === end) break;
        take(','); skip();
      }
      take(end);
      return value;
    }
    const token = /^(?:-?\d+(?:\.\d+)?|[A-Za-z_$][\w$]*)/.exec(text.slice(at))?.[0];
    if (!token) throw new Error('Unsupported model expression');
    at += token.length;
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^-?\d/.test(token)) return Number(token);
    if (Object.hasOwn(constants, token)) return constants[token];
    throw new Error('Unknown model constant');
  };
  const value = read();
  return { value, end: at };
}

// esbuild preserves these module markers in the published 0.66.0 chunks.
function moduleSection(text, name) {
  const marker = new RegExp(`^// packages/core/(?:dist/)?src/config/${name}\\.(?:js|ts)\\r?$`, 'm').exec(text);
  if (!marker) return /^\/\/ (?:packages|node_modules)\//m.test(text) ? '' : text;
  const rest = text.slice(marker.index + marker[0].length);
  const next = /^\/\/ \S+\.(?:js|ts|tsx)\r?$/m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

export function extractGeminiModelExports(text, known = {}) {
  const constants = Object.assign(Object.create(null), known);
  const modelsText = moduleSection(text, 'models');
  const declarations = [...modelsText.matchAll(/^(?:export\s+)?(?:const|let|var)\s+([A-Z][A-Z0-9_]*)\s*=\s*/gm)];
  // Alias declarations may refer to a later constant in a fixture/build.
  for (let pass = 0; pass < 2; pass++) for (const match of declarations) {
    try {
      const result = readLiteral(modelsText, match.index + match[0].length, constants);
      if (typeof result.value === 'string' && /^\s*;/.test(modelsText.slice(result.end))) constants[match[1]] = result.value;
    } catch { /* Functions, SDK objects and runtime expressions are not metadata. */ }
  }
  const validSet = /\bVALID_GEMINI_MODELS\s*=\s*(?:\/\*[^]*?\*\/\s*)?(?:new Set\(\s*)?(?=\[)/.exec(modelsText);
  if (validSet) try {
    const result = readLiteral(modelsText, validSet.index + validSet[0].length, constants);
    if (/^\s*\)?\s*;/.test(modelsText.slice(result.end))) constants.VALID_GEMINI_MODELS = result.value;
  } catch { /* Keep independently readable constants. */ }
  const configText = moduleSection(text, 'defaultModelConfigs');
  const configStart = /\bDEFAULT_MODEL_CONFIGS\s*=\s*\{/.exec(configText);
  if (configStart) {
    const tail = configText.slice(configStart.index);
    const definitions = /\bmodelDefinitions\s*:\s*\{/.exec(tail);
    if (definitions) try {
      constants.DEFAULT_MODEL_CONFIGS = { modelDefinitions: readLiteral(tail, definitions.index + definitions[0].length - 1, constants).value };
    } catch { /* Constants remain usable when a future config has new syntax. */ }
  }
  return constants;
}

export function normalizeGeminiModels(exports = {}) {
  const rows = new Map();
  const definitions = exports?.DEFAULT_MODEL_CONFIGS?.modelDefinitions ?? {};
  const add = (id, name) => {
    if (!validId(id) || /embedding/i.test(id) || definitions[id]?.isVisible === false || definitions[id]?.hidden) return;
    rows.set(id, { id, name: typeof name === 'string' && name.trim() ? name : id });
  };
  for (const [key, value] of Object.entries(exports ?? {})) {
    if (/^(?:.*(?:GEMINI|GEMMA).*_MODEL(?:_AUTO)?|GEMINI_MODEL_ALIAS_\w+)$/.test(key) && !key.includes('EMBEDDING')) add(value);
  }
  if (exports?.VALID_GEMINI_MODELS instanceof Set || Array.isArray(exports?.VALID_GEMINI_MODELS)) {
    for (const id of exports.VALID_GEMINI_MODELS) add(id);
  }
  for (const [id, definition] of Object.entries(definitions)) add(id, definition?.displayName);
  return [...rows.values()];
}

async function manifest(file, expected) {
  try { const json = JSON.parse(await fs.readFile(file, 'utf8')); return json.name === expected ? path.dirname(file) : null; } catch { return null; }
}

async function resolvePackage(anchor, name) {
  const require = createRequire(anchor);
  try { return await manifest(require.resolve(`${name}/package.json`), name); } catch { /* exports map may hide package.json */ }
  let dir;
  try { dir = path.dirname(require.resolve(name)); } catch { return null; }
  for (;;) {
    const root = await manifest(path.join(dir, 'package.json'), name);
    if (root) return root;
    const parent = path.dirname(dir); if (parent === dir) return null; dir = parent;
  }
}

async function readPackageModels(root, name) {
  const metadata = Object.create(null);
  if (name === CORE) {
    for (const dir of ['dist/src/config', 'dist/config', 'src/config']) for (const file of ['models.js', 'defaultModelConfigs.js']) {
      try { Object.assign(metadata, extractGeminiModelExports(await fs.readFile(path.join(root, dir, file), 'utf8'), metadata)); } catch { /* Try the next published layout. */ }
    }
    return metadata;
  }
  // Follow the launcher's local import graph so stale/unreferenced esbuild
  // chunks cannot contribute another version's models. Read text only.
  const bundle = path.join(root, 'bundle');
  const files = ['gemini.js'];
  const visited = new Set();
  for (let i = 0; i < files.length && i < 128; i++) {
    const file = files[i];
    if (visited.has(file)) continue;
    visited.add(file);
    try {
      const fullPath = path.join(bundle, file);
      if ((await fs.stat(fullPath)).size > 64 * 1024 * 1024) continue;
      const text = await fs.readFile(fullPath, 'utf8');
      if (/^\/\/ packages\/core\/(?:dist\/)?src\/config\/(?:models|defaultModelConfigs)\.(?:js|ts)\r?$/m.test(text)) {
        Object.assign(metadata, extractGeminiModelExports(text, metadata));
        if (metadata.DEFAULT_MODEL_CONFIGS && normalizeGeminiModels(metadata).length) return metadata;
      }
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']\.\/([\w.-]+\.js)["']/g)) {
        if (!visited.has(match[1]) && !files.includes(match[1])) files.push(match[1]);
      }
    } catch { /* A partially installed CLI still has the default/custom fallback. */ }
  }
  return metadata;
}

export async function discoverGeminiModelExports({ executable = findExecutable('gemini'), cwd = process.cwd() } = {}) {
  const anchors = [];
  if (executable) {
    try { anchors.push(await fs.realpath(executable)); } catch { /* Broken link/shim. */ }
    anchors.push(path.resolve(executable), path.resolve(path.dirname(executable), '../lib/gemini-model-discovery.cjs'));
  }
  anchors.push(path.resolve(cwd, 'gemini-model-discovery.cjs'), fileURLToPath(import.meta.url));
  const seen = new Set();
  for (const anchor of new Set(anchors)) {
    const cli = await resolvePackage(anchor, CLI);
    const core = await resolvePackage(cli ? path.join(cli, 'package.json') : anchor, CORE);
    // A bundled CLI owns its embedded core; a separately installed core may be
    // a different version. Unbundled CLIs fall through to their core dependency.
    for (const [root, name] of [[cli, CLI], [core, CORE]]) {
      if (!root || seen.has(root)) continue;
      seen.add(root);
      const exports = await readPackageModels(root, name);
      if (normalizeGeminiModels(exports).length) return exports;
    }
  }
  return {};
}

// This is installed metadata, not an account entitlement list. Custom IDs are
// accepted by withGeminiModel even if missing here. The UI owns the separate
// default option; every catalog row must have a nonempty model ID.
export async function listGeminiModels({ discoverImpl = discoverGeminiModelExports, ...options } = {}) {
  let discovered = [];
  try { discovered = normalizeGeminiModels(await discoverImpl(options)); } catch { /* No private diagnostics in API responses. */ }
  const rows = new Map(fallbackModels().map((row) => [row.id, row]));
  for (const row of discovered) rows.set(row.id, row);
  return { models: [...rows.values()], source: discovered.length ? 'gemini-cli' : 'fallback' };
}
