// P114 e: herdr 서버를 Electron·백엔드의 job과 프로세스 나무 밖에서 띄운다.
// 까닭: 백엔드가 herdr 서버를 바로 자식으로 띄우면(detached여도 부모 PID는 백엔드) 작업 관리자의 "프로세스 트리 끝내기"를 Electron에 하면
//   백엔드, herdr 서버, 그 패널의 셸과 claude가 모두 꺼졌다(P114 e, 개발용 판에서 확인). 판을 띄운 쪽의 job이 KILL_ON_JOB_CLOSE면 그 job과도 함께 끝난다.
// 방법: 잠깐 뜨는 PowerShell(5.1, Windows 기본)이 CreateProcessW를 DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_BREAKAWAY_FROM_JOB으로 부르고 끝난다.
//   그래서 herdr 서버의 부모는 이미 끝난 프로세스다(나무 밖). breakaway를 막는 job이면(ERROR_ACCESS_DENIED) breakaway 없이 띄운다(job 안, 나무 밖).
//   env는 판이 정한 값을 블록으로 넘긴다(PowerShell 자신의 PSModulePath 등이 섞이지 않게). stdout·stderr는 로그 파일, stdin은 NUL
// 요청(명령 줄, 폴더, env, 로그 경로)은 실행기의 stdin으로 넘긴다(2a-fix). env에는 사용자 환경 변수의 API 키가 들어 있어 파일로 쓰지 않는다
//   (전에는 요청 JSON을 로그 폴더에 썼고, 쓴 뒤 지우기 전에 백엔드가 죽으면 키가 디스크에 남았다). 결과 파일에는 PID와 breakaway만 쓴다
// hc 코어도 같은 플래그로 뜬다(hc platform/windows.rs). 여기는 그것을 herdr에 쓰는 것이다
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

// Windows 명령 줄 한 낱말(CommandLineToArgvW 규칙: 따옴표 앞 역슬래시는 두 배)
export function quoteArg(a) {
  const s = String(a);
  if (s && !/[\s"]/.test(s)) return s;
  let out = '"', bs = 0;
  for (const ch of s) {
    if (ch === '\\') { bs++; continue; }
    if (ch === '"') { out += '\\'.repeat(bs * 2 + 1) + '"'; bs = 0; continue; }
    out += '\\'.repeat(bs) + ch; bs = 0;
  }
  return out + '\\'.repeat(bs * 2) + '"';
}
export const commandLine = (file, args = []) => [file, ...args].map(quoteArg).join(' ');
// env → "이름=값" 목록(이름 순, 대소문자 무시로 겹치면 뒤의 것). CreateProcess의 env 블록이 된다
export function envList(env) {
  const by = new Map();
  for (const [k, v] of Object.entries(env || {})) if (k && !k.includes('=') && v != null) by.set(k.toUpperCase(), `${k}=${v}`);
  return [...by.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([, kv]) => kv);
}

const PS1 = String.raw`param([string]$Result)
$ErrorActionPreference = 'Stop'
# 요청은 stdin의 UTF-8 바이트(콘솔 코드 페이지를 거치지 않게 바이트로 읽는다)
$in = [Console]::OpenStandardInput(); $ms = New-Object System.IO.MemoryStream; $in.CopyTo($ms)
$r = [System.Text.Encoding]::UTF8.GetString($ms.ToArray()) | ConvertFrom-Json
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class AtriumDetach {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct SI { public int cb; public string r, d, t; public int x, y, w, h, cx, cy, fa, flags; public short sw, cbr; public IntPtr r2, hin, hout, herr; }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr hp, ht; public int pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct SA { public int n; public IntPtr d; public bool inherit; }
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool CreateProcessW(string app, StringBuilder cmd, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr env, string cwd, ref SI si, out PI pi);
  [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern IntPtr CreateFileW(string name, uint access, uint share, ref SA sa, uint disp, uint attrs, IntPtr tmpl);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  public static string Run(string cmd, string cwd, string[] env, string log) {
    SA sa = new SA(); sa.n = Marshal.SizeOf(typeof(SA)); sa.inherit = true;
    IntPtr nul = CreateFileW("NUL", 0x80000000, 3, ref sa, 3, 0, IntPtr.Zero);
    IntPtr outf = CreateFileW(log, 0x0004, 3, ref sa, 4, 0x80, IntPtr.Zero); // FILE_APPEND_DATA, OPEN_ALWAYS
    SI si = new SI(); si.cb = Marshal.SizeOf(typeof(SI)); si.flags = 0x100; si.hin = nul; si.hout = outf; si.herr = outf;
    StringBuilder b = new StringBuilder(); foreach (string kv in env) { b.Append(kv); b.Append('\0'); } b.Append('\0');
    IntPtr block = Marshal.StringToHGlobalUni(b.ToString());
    uint f = 0x8 | 0x200 | 0x400; // DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT
    PI pi; bool brk = true;
    bool ok = CreateProcessW(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, true, f | 0x01000000, block, cwd, ref si, out pi);
    int err = ok ? 0 : Marshal.GetLastWin32Error();
    if (!ok && err == 5) { brk = false; ok = CreateProcessW(null, new StringBuilder(cmd), IntPtr.Zero, IntPtr.Zero, true, f, block, cwd, ref si, out pi); err = ok ? 0 : Marshal.GetLastWin32Error(); }
    Marshal.FreeHGlobal(block); CloseHandle(nul); CloseHandle(outf);
    if (!ok) return "{\"error\":" + err + "}";
    CloseHandle(pi.hp); CloseHandle(pi.ht);
    return "{\"pid\":" + pi.pid + ",\"breakaway\":" + (brk ? "true" : "false") + "}";
  }
}
"@
$out = [AtriumDetach]::Run($r.cmd, $r.cwd, [string[]]@($r.env), $r.log)
[System.IO.File]::WriteAllText($Result, $out)
`;

// → { pid, breakaway, ms }. 실행기가 실패하면 던진다(부르는 쪽이 지금 방식으로 띄운다)
export async function spawnDetached({ file, args = [], cwd = process.cwd(), env = process.env, logFile, workDir }) {
  fs.mkdirSync(workDir, { recursive: true });
  const id = crypto.randomBytes(5).toString('hex');
  const ps1 = path.join(workDir, 'herdr-detach.ps1');
  const result = path.join(workDir, `herdr-detach-${id}.result.json`); // PID와 breakaway만 쓴다(env 값 없음)
  if (!fs.existsSync(ps1) || fs.readFileSync(ps1, 'utf8') !== PS1) fs.writeFileSync(ps1, PS1);
  const request = Buffer.from(JSON.stringify({ cmd: commandLine(file, args), cwd, env: envList(env), log: logFile }), 'utf8');
  const t0 = Date.now();
  try {
    const code = await new Promise((resolve, reject) => {
      const sys = process.env.SystemRoot || 'C:\\Windows';
      // detached(콘솔 없음)로 띄운 PowerShell은 스크립트를 돌리지 않고 끝났다(P114 e). 실행기는 곧 끝나므로 보통 자식으로 띄운다.
      // libuv가 자식을 넣는 job은 BREAKAWAY_OK·SILENT_BREAKAWAY_OK라 실행기가 띄운 herdr는 그 job에 들지 않는다(P114 1단계)
      // 요청은 stdin으로(파일로 쓰지 않는다). 다 쓰고 닫아야 실행기가 읽기를 끝낸다
      const p = spawn(path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, result], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true });
      const timer = setTimeout(() => { try { p.kill(); } catch {} reject(Object.assign(new Error('detach launcher timed out'), { code: 'detach_timeout' })); }, 20000);
      p.on('error', (e) => { clearTimeout(timer); reject(Object.assign(e, { code: 'detach_spawn' })); });
      p.on('exit', (c) => { clearTimeout(timer); resolve(c); });
      p.stdin.on('error', () => {}); // 실행기가 먼저 끝나면(EPIPE) exit로 판단한다
      p.stdin.end(request);
    });
    let r = null;
    try { r = JSON.parse(fs.readFileSync(result, 'utf8')); } catch {}
    if (!r || r.error != null || !r.pid) throw Object.assign(new Error(`detach launcher failed (exit ${code}, ${r ? `win32 error ${r.error}` : 'no result'})`), { code: 'detach_failed', win32: r ? r.error : null });
    return { pid: r.pid, breakaway: !!r.breakaway, ms: Date.now() - t0 };
  } finally { fs.rmSync(result, { force: true }); }
}
