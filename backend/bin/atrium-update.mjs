// macOS release/version CLI. Source checkouts can check versions and open the
// supported packaged-app route; they never download source and run npm/build.
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { connect, backendInfo, health } from '../src/client.mjs';
import * as U from '../src/update.mjs';
export function channelFlag(flags = {}) {
  if (flags.channel == null) return null;
  if (!U.CHANNELS.includes(flags.channel)) throw U.fail('bad_request', '--channel requires stable or dev');
  return flags.channel;
}
export async function updateCommand(cfg, cmd, flags = {}, { out = value => console.log(JSON.stringify(value, null, 2)), json = false, connection = { connect, backendInfo, health }, fetchJson = U.httpGetJson } = {}) {
  const channel = channelFlag(flags), root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  if (flags.rollback) throw U.fail('unsupported', 'Only failed-health rollback is automatic. Install an explicit packaged release manually to downgrade.');
  const info = connection.backendInfo(cfg), up = info && await connection.health(info.port);
  if (cmd === 'install') {
    const result = { supported: false, reason: 'manual_bundle_install', url: U.RELEASES_URL, message: 'Download the macOS ZIP or DMG for your Mac, verify SHA256SUMS.txt, and move Atrium.app to Applications. Node and herdr are included. Source auto-update is unsupported.' };
    return json ? out(result) : console.log(`${result.message}\n${result.url}`);
  }
  if (!up) {
    const current = U.runningVersion(root);
    if (!flags.check) throw U.fail('backend_not_running', `Open the installed Atrium.app to update, or download a packaged release: ${U.RELEASES_URL}`);
    const apiUrl = U.updateApiOf();
    if (apiUrl !== U.DEFAULT_UPDATE_API) throw U.fail('unsafe_update_api', 'Use the isolated dev app to test a loopback releases API.');
    const latest = await U.fetchLatest(fetchJson, apiUrl, channel || 'stable');
    return print({ current, channel: channel || 'stable', latest, available: !!latest && U.compareVersions(latest.version, current.version) > 0, allowed: false, reason: 'backend_not_running', manualUrl: U.RELEASES_URL }, out, json);
  }
  const c = await connection.connect(cfg);
  try {
    if (flags.check) return print(await c.call('update.check', channel ? { channel } : {}), out, json);
    const result = await c.call('update.apply', { confirm: flags.yes === true, ...(channel ? { channel } : {}), ...(typeof flags.tag === 'string' ? { tag: flags.tag } : {}) });
    if (result.needsConfirm) { if (json) out(result); else console.log(`${result.message}\nContinue with --yes`); process.exitCode = 2; return; }
    return json ? out(result) : console.log(`Preparing ${result.to}. The app will reopen after bundle and backend health checks. Check Settings → Updates for the result.`);
  } finally { c.close(); }
}
function print(v, out, json) {
  if (json) return out(v);
  console.log(`Current: ${v.current.version || 'unknown'}\nChannel: ${v.channel}\n${v.latest ? `Latest: ${v.latest.tag}${v.available ? ' (update available)' : ''}` : 'No release found'}${v.error ? `\nError: ${v.error}` : ''}${v.allowed === false ? `\nManual install: ${v.manualUrl || U.RELEASES_URL}` : ''}`);
}
