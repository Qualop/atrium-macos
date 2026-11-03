import { splitArgs } from './gemini-args.mjs';
export { splitArgs };

const badRequest = (message) => Object.assign(new Error(message), { code: 'bad_request' });
const hasValue = (args, i) => args[i + 1] !== undefined && !args[i + 1].startsWith('-');
function modelOption(args, i) {
  const arg = args[i];
  if (arg === '-m' || arg === '--model') return { value: hasValue(args, i) ? args[i + 1] : '', count: hasValue(args, i) ? 2 : 1 };
  if (arg.startsWith('--model=')) return { value: arg.slice(8), count: 1 };
  if (arg.startsWith('-m') && arg.length > 2) return { value: arg.slice(2).replace(/^=/, ''), count: 1 };
  const separate = arg === '-c' || arg === '--config';
  const config = separate ? args[i + 1] : arg.startsWith('--config=') ? arg.slice(9) : arg.startsWith('-c') ? arg.slice(2).replace(/^=/, '') : null;
  const match = /^\s*model\s*=\s*([\s\S]*)$/.exec(config ?? '');
  if (!match) return null;
  let value = match[1].trim();
  if (value.startsWith('"')) { try { value = JSON.parse(value); } catch { value = ''; } }
  else if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  return { value: typeof value === 'string' ? value : '', count: separate ? 2 : 1 };
}
export function modelFromArgs(value) {
  let args; try { args = splitArgs(value); } catch { return ''; }
  let model = '';
  for (let i = 0; i < args.length && args[i] !== '--'; i++) {
    const option = modelOption(args, i);
    if (option) { model = option.value; i += option.count - 1; }
  }
  return model;
}
export function withCodexModel(value, model) {
  const args = splitArgs(value);
  if (args.some((arg) => arg.includes('\0'))) throw badRequest('Invalid argument');
  if (model === undefined) return args;
  const id = String(model ?? '').trim();
  if (id && !/^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,199}$/.test(id)) throw badRequest('Invalid model ID');
  const kept = [];
  let i = 0;
  for (; i < args.length && args[i] !== '--'; i++) {
    const option = modelOption(args, i);
    if (option) i += option.count - 1;
    else kept.push(args[i]);
  }
  return [...kept, ...(id ? ['--model', id] : []), ...args.slice(i)];
}
