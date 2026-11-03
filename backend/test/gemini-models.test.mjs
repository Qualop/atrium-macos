import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { listGeminiModels, extractGeminiModelExports, normalizeGeminiModels } from '../src/gemini-models.mjs';
import { withGeminiModel } from '../src/gemini-args.mjs';

const constants = `
export const PREVIEW_GEMINI_MODEL = 'fixture-preview';
export const DEFAULT_GEMINI_MODEL = 'fixture-pro';
export const BASE_GEMINI_FLASH_MODEL = 'fixture-flash';
export let DEFAULT_GEMINI_FLASH_MODEL = BASE_GEMINI_FLASH_MODEL;
export const DEFAULT_GEMINI_MODEL_AUTO = 'auto-fixture';
export const GEMINI_MODEL_ALIAS_AUTO = 'auto';
export const GEMINI_MODEL_ALIAS_PRO = 'pro';
export const DEFAULT_GEMINI_EMBEDDING_MODEL = 'fixture-embedding';
export const PREVIEW_GEMINI_FLASH_LITE_MODEL = 'none';
export const UNRELATED = 'invented-model';
`;
const config = `
export const DEFAULT_MODEL_CONFIGS = {
  modelDefinitions: {
    'fixture-pro': { displayName: 'Fixture Pro', isVisible: true, features: { thinking: true } },
    'fixture-preview': { isVisible: false },
    'fixture-config-only': { displayName: 'Config Only', isVisible: true },
    auto: { displayName: 'Auto', isVisible: true },
    'internal-worker': { isVisible: false },
  },
};
`;

async function write(file, text) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, text); }
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atrium-gemini-models-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function packageAt(root, name, extra = {}) {
  const dir = path.join(root, 'node_modules', name);
  await write(path.join(dir, 'package.json'), JSON.stringify({ name, type: 'module', main: 'dist/index.js', ...extra }));
  await write(path.join(dir, 'dist/index.js'), 'throw new Error("Package entry must never execute");');
  return dir;
}

test('normalizes exported constants/config, preserving IDs and excluding hidden/embedding/sentinel entries', () => {
  const exports = extractGeminiModelExports(constants + config);
  assert.deepEqual(normalizeGeminiModels(exports), [
    { id: 'fixture-pro', name: 'Fixture Pro' },
    { id: 'fixture-flash', name: 'fixture-flash' },
    { id: 'auto-fixture', name: 'auto-fixture' },
    { id: 'auto', name: 'Auto' },
    { id: 'pro', name: 'pro' },
    { id: 'fixture-config-only', name: 'Config Only' },
  ]);
  assert.deepEqual(normalizeGeminiModels({ VALID_GEMINI_MODELS: new Set(['custom/from-set', 'none', null, 'bad model']) }), [{ id: 'custom/from-set', name: 'custom/from-set' }]);
});

test('discovery injection is deterministic and keeps fallback IDs available', async () => {
  let options;
  const result = await listGeminiModels({ executable: 'fixture', discoverImpl: async (input) => { options = input; return extractGeminiModelExports(constants + config); } });
  assert.deepEqual(options, { executable: 'fixture' });
  assert.equal(result.source, 'gemini-cli');
  assert.deepEqual(result.models[0], { id: 'auto', name: 'Auto' });
  assert.equal(new Set(result.models.map((row) => row.id)).size, result.models.length);
  assert.ok(result.models.every((row) => Object.keys(row).join(',') === 'id,name'));
  assert.ok(result.models.every((row) => row.id.length > 0));
});

test('missing, broken, or unrecognized metadata falls back without invented models or private diagnostics', async () => {
  for (const discoverImpl of [async () => ({}), async () => null, async () => { throw new Error('/private/auth/secret'); }]) {
    assert.deepEqual(await listGeminiModels({ discoverImpl }), { models: [{ id: 'auto', name: 'Auto' }], source: 'fallback' });
  }
  assert.deepEqual(withGeminiModel('', 'custom/not-in-catalog'), ['--model', 'custom/not-in-catalog']);
});

test('reads a locally installed core package statically, without importing any code', async (t) => {
  const root = await fixture(t);
  const core = await packageAt(root, '@google/gemini-cli-core');
  await write(path.join(core, 'dist/src/config/models.js'), 'throw new Error("No imports");\n' + constants);
  await write(path.join(core, 'dist/src/config/defaultModelConfigs.js'), 'throw new Error("No auth");\n' + config);
  const result = await listGeminiModels({ executable: null, cwd: root });
  assert.equal(result.source, 'gemini-cli');
  assert.ok(result.models.some((row) => row.id === 'fixture-pro' && row.name === 'Fixture Pro'));
  assert.ok(!result.models.some((row) => row.id === 'fixture-preview'));
});

test('resolves nested CLI core dependencies through a global executable symlink', async (t) => {
  const root = await fixture(t);
  const cli = await packageAt(path.join(root, 'prefix/lib'), '@google/gemini-cli');
  const core = await packageAt(cli, '@google/gemini-cli-core');
  await write(path.join(core, 'dist/src/config/models.js'), constants);
  const executable = path.join(root, 'prefix/bin/gemini');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.symlink(path.join(cli, 'dist/index.js'), executable);
  const result = await listGeminiModels({ executable, cwd: root });
  assert.equal(result.source, 'gemini-cli');
  assert.ok(result.models.some((row) => row.id === 'fixture-flash'));
});

test('reads esbuild bundle metadata from a fake npm CLI without executing its launcher', async (t) => {
  const root = await fixture(t);
  const cli = await packageAt(root, '@google/gemini-cli', { bin: { gemini: 'bundle/gemini.js' } });
  await write(path.join(cli, 'bundle/gemini.js'), 'import "./chunk-fixture.js"; throw new Error("Launcher must never execute");');
  await write(path.join(cli, 'bundle/chunk-fixture.js'), `
// packages/core/dist/src/config/models.js
${constants.replaceAll('export const', 'var').replaceAll('export let', 'var')}
// packages/core/dist/src/config/defaultModelConfigs.js
${config.replaceAll('export const', 'var')}
// packages/unrelated.js
var DEFAULT_GEMINI_FAKE_MODEL = 'invented-from-unrelated-code';
throw new Error('Never evaluate bundles');
`);
  const result = await listGeminiModels({ executable: null, cwd: root });
  assert.equal(result.source, 'gemini-cli');
  assert.ok(result.models.some((row) => row.id === 'fixture-config-only'));
  assert.ok(!result.models.some((row) => row.id.includes('invented')));
});

test('unsupported runtime expressions never execute and do not become model IDs', () => {
  const source = constants + `
export const DEFAULT_GEMINI_DYNAMIC_MODEL = (() => { throw new Error('never'); })();
export const PREVIEW_GEMINI_DYNAMIC_MODEL = 'fake-' + 'dynamic';
export const DEFAULT_MODEL_CONFIGS = { modelDefinitions: loadPrivateSettings() };
`;
  const rows = normalizeGeminiModels(extractGeminiModelExports(source));
  assert.ok(rows.some((row) => row.id === 'fixture-pro'));
  assert.ok(!rows.some((row) => row.id.startsWith('fake-')));
});

test('reads literal sets and resolves computed config keys across separate core files', async (t) => {
  const root = await fixture(t);
  const core = await packageAt(root, '@google/gemini-cli-core');
  await write(path.join(core, 'dist/src/config/models.js'), constants + `
export const VALID_GEMINI_MODELS = /* @__PURE__ */ new Set([DEFAULT_GEMINI_MODEL, 'fixture-set-only']);
`);
  await write(path.join(core, 'dist/src/config/defaultModelConfigs.js'), `
export const DEFAULT_MODEL_CONFIGS = { modelDefinitions: {
  [DEFAULT_GEMINI_MODEL]: { displayName: 'Computed Key', isVisible: true },
} };
`);
  const result = await listGeminiModels({ executable: null, cwd: root });
  assert.ok(result.models.some((row) => row.id === 'fixture-set-only'));
  assert.ok(result.models.some((row) => row.id === 'fixture-pro' && row.name === 'Computed Key'));
});

test('only active bundle imports supply models; stale chunks are ignored', async (t) => {
  const root = await fixture(t);
  const cli = await packageAt(root, '@google/gemini-cli');
  await write(path.join(cli, 'bundle/gemini.js'), 'import "./chunk-current.js";');
  await write(path.join(cli, 'bundle/chunk-current.js'), `
// packages/core/src/config/models.ts
${constants}
import './chunk-definitions.js';
`);
  await write(path.join(cli, 'bundle/chunk-definitions.js'), `
// packages/core/src/config/defaultModelConfigs.ts
${config}
`);
  await write(path.join(cli, 'bundle/chunk-aaa-stale.js'), `
// packages/core/src/config/models.ts
var DEFAULT_GEMINI_MODEL = 'stale-model';
`);
  const unrelatedCore = await packageAt(root, '@google/gemini-cli-core');
  await write(path.join(unrelatedCore, 'dist/src/config/models.js'), "export const DEFAULT_GEMINI_MODEL = 'unrelated-core-model';");
  const result = await listGeminiModels({ executable: null, cwd: root });
  assert.ok(result.models.some((row) => row.id === 'fixture-pro' && row.name === 'Fixture Pro'));
  assert.ok(!result.models.some((row) => row.id === 'stale-model'));
  assert.ok(!result.models.some((row) => row.id === 'unrelated-core-model'));
});

test('supports npm wrapper layouts and package exports hiding package.json', async (t) => {
  const root = await fixture(t);
  const core = await packageAt(root, '@google/gemini-cli-core', { exports: './dist/index.js' });
  await write(path.join(core, 'dist/config/models.js'), constants);
  const executable = path.join(root, 'gemini.cmd');
  await write(executable, '@echo off\nREM never executed\n');
  assert.equal((await listGeminiModels({ executable, cwd: path.join(root, 'other') })).source, 'gemini-cli');
});

test('a failed lookup is not cached across later CLI installation', async (t) => {
  const root = await fixture(t);
  assert.equal((await listGeminiModels({ executable: null, cwd: root })).source, 'fallback');
  const core = await packageAt(root, '@google/gemini-cli-core');
  await write(path.join(core, 'dist/src/config/models.js'), constants);
  assert.equal((await listGeminiModels({ executable: null, cwd: root })).source, 'gemini-cli');
});
