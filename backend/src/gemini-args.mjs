const badRequest = (message) => Object.assign(new Error(message), { code: 'bad_request' });

// Shell-style quoting only: no expansion, substitution, or shell execution.
// Arrays are already argv and must not be unquoted a second time.
export function splitArgs(value) {
  if (Array.isArray(value)) return value.map(String);
  const text = String(value ?? '');
  const out = [];
  let word = '', quote = null, active = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\' && quote !== "'") {
      const next = text[i + 1];
      if (next === undefined) throw badRequest('Trailing escape in arguments');
      if (!quote || /["\\$`\n]/.test(next)) {
        i++;
        if (next !== '\n') { word += next; active = true; }
      } else { word += c; active = true; }
    } else if (quote) {
      if (c === quote) quote = null;
      else word += c;
      active = true;
    } else if (c === '"' || c === "'") { quote = c; active = true; }
    else if (/\s/.test(c)) {
      if (active) out.push(word);
      word = ''; active = false;
    } else { word += c; active = true; }
  }
  if (quote) throw badRequest('Unclosed quote in arguments');
  if (active) out.push(word);
  return out;
}

const forbidden = new Set(['resume', 'r', 'session-id', 'session-file', 'prompt', 'p', 'acp', 'experimental-acp']);

// Call before the parent appends its own --session-id. A terminator would also
// turn that parent-owned flag into prompt text, so it is not allowed here.
export function validateGeminiNewSessionArgs(value) {
  const args = splitArgs(value);
  for (const arg of args) {
    if (arg.includes('\0')) throw badRequest('Invalid argument');
    if (arg === '--') throw badRequest('Argument terminator is not allowed for a new Gemini session');
    if (arg.startsWith('--')) {
      const flag = arg.slice(2).split(/[=.]/, 1)[0].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^no-/, '');
      if (forbidden.has(flag)) throw badRequest(`--${flag} is managed by Atrium`);
    } else if (/^-[^-]/.test(arg)) {
      // yargs accepts grouped boolean switches followed by a value-taking one.
      // Once -m/-i consumes the rest, letters in its value are not switches.
      for (const c of arg.slice(1)) {
        if (c === 'r' || c === 'p') throw badRequest(`-${c} is managed by Atrium`);
        if ('miewo'.includes(c) || c === '=') break;
      }
    }
  }
  return args;
}

function modelOption(arg) {
  const grouped = /^-([dsy]+)m(.*)$/.exec(arg);
  if (grouped) return { prefix: `-${grouped[1]}`, ...(grouped[2] ? { value: grouped[2].replace(/^=/, '') } : { separate: true }) };
  if (arg === '-m' || arg === '--model') return { separate: true };
  if (arg.startsWith('--model=')) return { value: arg.slice(8) };
  if (arg.startsWith('-m') && arg.length > 2) return { value: arg.slice(2).replace(/^=/, '') };
  return null;
}

export function geminiModelFromArgs(value) {
  let args;
  try { args = splitArgs(value); } catch { return ''; }
  let model = '';
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const option = modelOption(args[i]);
    if (!option) continue;
    model = option.separate ? (args[i + 1] !== undefined && !args[i + 1].startsWith('-') ? args[++i] : '') : option.value;
  }
  return model;
}

// undefined preserves the supplied model, null/empty clears it (CLI default),
// and 'auto' or a custom ID is passed literally. Never strip -c/--config flags.
export function withGeminiModel(value, model) {
  const args = validateGeminiNewSessionArgs(value);
  if (model === undefined) return args;
  const id = String(model ?? '').trim();
  if (id && !/^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,511}$/.test(id)) throw badRequest('Invalid model ID');
  const kept = [];
  for (let i = 0; i < args.length; i++) {
    const option = modelOption(args[i]);
    if (!option) kept.push(args[i]);
    else {
      if (option.prefix) kept.push(option.prefix);
      if (option.separate && args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++;
    }
  }
  return id ? [...kept, '--model', id] : kept;
}
