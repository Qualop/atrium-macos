import { execFile } from 'node:child_process';
import path from 'node:path';

// ps의 RSS는 KiB. Windows 작업 집합과 같은 byte 단위로 맞춘다.
export function parsePs(text, commands) {
  const procs = new Map();
  const args = new Map();
  for (const line of String(commands || '').split('\n')) {
    const m = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (m) args.set(Number(m[1]), m[2]);
  }
  for (const line of String(text).split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, pid, ppid, rss, comm] = m;
    procs.set(Number(pid), { pid: Number(pid), ppid: Number(ppid), ws: Number(rss) * 1024, name: path.basename(comm), cmd: args.get(Number(pid)) || comm });
  }
  return procs;
}
export async function readPosixProcesses() {
  const read = (fields) => new Promise((resolve) => {
    execFile('/bin/ps', ['-axo', fields], { encoding: 'utf8', timeout: 10000, maxBuffer: 32 * 1024 * 1024 }, (err, out) => resolve(err ? null : out));
  });
  const [table, commands] = await Promise.all([read('pid=,ppid=,rss=,comm='), read('pid=,args=')]);
  return table === null || commands === null ? null : parsePs(table, commands);
}
