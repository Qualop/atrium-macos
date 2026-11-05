// 판 설정(P6b, ARCH 4절 I7): 판 기록(meta 표의 `settings`)에 둔다. P16: 화면 언어(language, 기본 영어). 창과 Electron main이 settings.get으로 읽고 settings.updated 이벤트로 따라간다.
// 트레이 상주(tray, P14부터 기본 켜짐), P10의 보관 기간(archiveDays)과 리포 스스로 찾기(autoOpenRepos). 창 쪽 설정 화면은 P6c가 만들었다.
// P8: 가지 펼치기 상한과 기존 새 세션 기본값은 계속 유지한다.
// P33: 호출자는 기존 기본값에서 한 번 옮긴다. 호출자 없이 띄울 때는 기존 설정을 쓴다.

import { DEFAULT_MODEL as DEEPSEEK_MODEL, COMMAND_MAX } from './deepseek.mjs';

export const EFFORTS = ['', 'low', 'medium', 'high', 'xhigh', 'max']; // claude --effort. 빈 값이면 넘기지 않는다
export const PERMISSION_MODES = ['manual', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

export const LANGUAGES = ['en', 'ko']; // P16: 화면 언어. 새 판은 영어

export const SETTINGS = {
  language: { type: 'choice', default: 'en', options: LANGUAGES, label: '화면 언어(en 영어, ko 한국어). 창과 트레이 메뉴가 따른다(P16)' },
  tray: { type: 'boolean', default: true, label: '창을 닫아도 트레이에 남아 알림을 띄운다(I7). 트레이 메뉴로 백엔드를 켜고 끈다(P14)' },
  branchMaxChildren: { type: 'number', default: 4, min: 1, max: 16, label: '세션 하나가 만들 수 있는 하위 세션 수(K3)' },
  branchMaxDepth: { type: 'number', default: 3, min: 2, max: 6, label: '나무 깊이(사람이 띄운 세션이 1단계, K3)' },
  branchMaxTotal: { type: 'number', default: 16, min: 1, max: 64, label: '판 전체 하위 세션 수(K3)' },
  // P10: 보관과 리포 스스로 찾기(archive.mjs, recall.mjs). 0일이면 저절로 보관을 끈다(손 보관은 그대로)
  archiveDays: { type: 'number', default: 14, min: 0, max: 365, label: '마지막 활동이 이 일수보다 오래된 판 밖 대화와 닫힌 세션은 보관으로 본다(0이면 끔)' },
  autoOpenRepos: { type: 'boolean', default: true, label: '터미널(Claude Code CLI)에서 일한 리포를 워크스페이스로 저절로 연다' },
  claudeModel: { type: 'string', default: '', max: 80, pattern: /^[A-Za-z0-9._:/\[\]-]*$/, label: 'Claude Code 모델(비우면 Claude Code 기본. 세션 안에서 /model로 바꾼다)' },
  claudeEffort: { type: 'choice', default: '', options: EFFORTS, label: 'Claude Code 노력 수준(비우면 Claude Code 기본)' },
  claudePermissionMode: { type: 'choice', default: 'manual', options: PERMISSION_MODES, label: 'Claude Code 권한 모드' },
  claudeAllowHerdr: { type: 'boolean', default: false, label: 'herdr 명령 자동 승인(herdr, test, printf, echo만)' },
  codexArgs: { type: 'string', default: '', max: 300, label: 'Codex 실행 인자(따옴표로 묶은 인자를 지원한다)' },
  deepseekModel: { type: 'string', default: DEEPSEEK_MODEL, max: 80, pattern: /^[A-Za-z0-9._:/\[\]-]*$/, label: `DeepSeek 모델(판이 띄우는 Claude Code의 --model. opencodex 프록시가 DeepSeek로 보낸다. 비우면 ${DEEPSEEK_MODEL})` },
  deepseekCommand: { type: 'string', default: '', max: COMMAND_MAX, pattern: /^[^\x00-\x1f\x7f]*$/, hint: '한 줄, 줄바꿈·탭 없이', label: 'DeepSeek 직접 명령(셸 한 줄. 비우면 위 모델로 판이 Claude Code를 띄우고, 채우면 새 셸 패널에 그대로 친다. hook 없음)' },
  // P40: herdr 실행 파일 경로. 비우면 찾는다(ATRIUM_HERDR 다음, 설치기 current 링크·PATH·알려진 폴더보다 먼저). 바꾸면 백엔드가 다시 찾는다
  herdrPath: { type: 'string', default: '', max: 1024, label: 'herdr 실행 파일 경로(비우면 herdr 설치 폴더와 PATH에서 찾는다, P40)' },
  // P49(R3): Tailscale로 온 요청의 로그인 사용자 제한. 켜져 있으면 이 PC에 로그인한 Tailscale 사용자와 허용 목록만 짝 맺고 연결한다. 이 PC의 창에서만 바꾼다
  remoteSameUser: { type: 'boolean', default: true, label: 'Tailscale로 온 요청은 이 PC의 Tailscale 사용자와 허용 목록의 사용자만 받는다(P49)' },
  remoteAllowedLogins: { type: 'string', default: '', max: 1000, pattern: /^[A-Za-z0-9._%+@,\s-]*$/, hint: '로그인 이름을 쉼표로', label: '더 받을 Tailscale 로그인 이름(쉼표로 여럿, P49)' },
  sleepAfterMin: { type: 'number', default: 30, min: 0, max: 1440, label: '리포(워크스페이스)에 이 분 동안 아무 일이 없으면 그 리포의 판 Claude Code 세션을 모두 잠재운다(0이면 저절로 잠재우지 않음, P21·P24 D4)' },
};
export const DEFAULTS = Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, v.default]));

const BOOL = { true: true, false: false, on: true, off: false, '1': true, '0': false, yes: true, no: false };
// 바꿀 값 확인: 모르는 키와 맞지 않는 값은 거부한다. 'on'/'off' 같은 글도 받는다(atrium CLI)
export function normalizePatch(patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw Object.assign(new Error('바꿀 설정이 없다'), { code: 'bad_request' });
  const out = {};
  for (const [k, v] of Object.entries(patch)) {
    const d = Object.hasOwn(SETTINGS, k) ? SETTINGS[k] : null;
    if (!d) throw Object.assign(new Error(`모르는 설정: ${k}`), { code: 'bad_request' });
    if (d.type === 'boolean') {
      const key = String(v).toLowerCase();
      const b = typeof v === 'boolean' ? v : Object.hasOwn(BOOL, key) ? BOOL[key] : undefined;
      if (b === undefined) throw Object.assign(new Error(`${k}는 참/거짓`), { code: 'bad_request' });
      out[k] = b;
    } else if (d.type === 'number') {
      const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN;
      if (!Number.isInteger(n) || n < d.min || n > d.max) throw Object.assign(new Error(`${k}는 ${d.min}~${d.max}의 정수`), { code: 'bad_request' });
      out[k] = n;
    } else if (d.type === 'choice') {
      const c = String(v ?? '').trim();
      if (!d.options.includes(c)) throw Object.assign(new Error(`${k}는 ${d.options.map((o) => o || '(빈 값)').join(', ')} 가운데 하나`), { code: 'bad_request' });
      out[k] = c;
    } else if (d.type === 'string') {
      const t = String(v ?? '').trim();
      if (t.length > d.max || (d.pattern && !d.pattern.test(t))) throw Object.assign(new Error(`${k}: 맞지 않는 값(${d.max}자까지${d.pattern ? `, ${d.hint || '영문·숫자·._:/[]-만'}` : ''})`), { code: 'bad_request' });
      out[k] = t;
    }
  }
  return out;
}

export class Settings {
  constructor({ store, broadcast }) { this.store = store; this.broadcast = broadcast; }
  // 정의에 있는 키만 보인다. 기존 호출자의 기본값도 계속 읽을 수 있다.
  get() { const raw = this.store.getMeta('settings') || {}; return Object.fromEntries(Object.keys(SETTINGS).map((k) => [k, k in raw ? raw[k] : DEFAULTS[k]])); }
  describe() { return Object.fromEntries(Object.entries(SETTINGS).map(([k, v]) => [k, { type: v.type, default: v.default, label: v.label, ...(v.type === 'number' ? { min: v.min, max: v.max } : {}), ...(v.type === 'choice' ? { options: v.options } : {}), ...(v.type === 'string' ? { max: v.max } : {}) }])); }
  // settings.set { tray: true } 또는 { key: 'tray', value: true }
  set(p) {
    const patch = normalizePatch(p && p.key ? { [p.key]: p.value } : p);
    const next = { ...this.get(), ...patch };
    this.store.setMeta('settings', { ...(this.store.getMeta('settings') || {}), ...next }); // 옛 키는 지우지 않는다
    this.broadcast('settings.updated', next);
    return next;
  }
}
