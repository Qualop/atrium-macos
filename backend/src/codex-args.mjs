export function splitArgs(value) {
  if (Array.isArray(value)) return value.map(String);
  const out = []; let word = '', quote = null, active = false;
  for (const c of String(value || '')) {
    if (quote) { if (c === quote) quote = null; else word += c; active = true; }
    else if (c === '"' || c === "'") { quote = c; active = true; }
    else if (/\s/.test(c)) { if (active) out.push(word); word = ''; active = false; }
    else { word += c; active = true; }
  }
  if (quote) throw new Error('Unclosed quote in arguments');
  if (active) out.push(word);
  return out;
}
export function modelFromArgs(value) {
  let args; try { args = splitArgs(value); } catch { return ''; }
  let model = '';
  args.forEach((a, i) => {
    if (a === '-m' || a === '--model') model = args[i + 1] || '';
    else if (a.startsWith('--model=')) model = a.slice(8);
    else if (a.startsWith('-m') && a.length > 2) model = a.slice(2).replace(/^=/, '');
    else if ((args[i - 1] === '-c' || args[i - 1] === '--config') && a.startsWith('model=')) model = a.slice(6);
  });
  return model;
}
export function withCodexModel(value, model) {
  const args = splitArgs(value);
  if (model === undefined) return args;
  const id = String(model).trim();
  if (id && !/^[A-Za-z0-9][A-Za-z0-9._:/\[\]-]{0,199}$/.test(id)) throw Object.assign(new Error('Invalid model ID'), { code: 'bad_request' });
  const kept = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-m' || a === '--model') { i++; continue; }
    if (a.startsWith('--model=') || (a.startsWith('-m') && a.length > 2)) continue;
    if ((a === '-c' || a === '--config') && args[i + 1]?.startsWith('model=')) { i++; continue; }
    if (/^(?:--config=|-c)model=/.test(a)) continue;
    kept.push(a);
  }
  return id ? [...kept, '--model', id] : kept;
}
