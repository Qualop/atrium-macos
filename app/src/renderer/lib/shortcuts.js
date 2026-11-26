const onMac = () => typeof navigator !== 'undefined' ? /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '') : typeof process !== 'undefined' && process.platform === 'darwin';

// 실제로 Command를 지원하는 앱 단축키만 바꾼다. 터미널 제어 키와 Ctrl 드래그는 유지한다.
// macOS 판: Windows에서만 맞는 말(Windows Hello, PowerShell, 이 PC, 트레이, Alt, Ctrl+클릭, C:\ 경로)을 Mac 말로 바꾼다.
// 판의 문구는 원본(Windows)과 같이 두고 Mac에서 보일 때만 바꾼다(원본을 합칠 때 사전이 갈라지지 않게)
const MAC_WORDS = [
  [/Windows Hello, Touch ID/g, 'Touch ID'], [/Windows Hello/g, 'Touch ID'],
  [/run it again in PowerShell opened as administrator/g, 'run it again with sudo in front in Terminal'],
  [/관리자 권한으로 PowerShell을 열어 다시 실행하세요/g, '터미널에서 앞에 sudo를 붙여 다시 실행하세요'],
  [/in PowerShell on this PC/g, 'in Terminal on this Mac'], [/이 PC의 PowerShell에서/g, '이 Mac의 터미널에서'],
  [/\(Windows에서는 시스템 트레이\)/g, ''],
  [/the tray menu/g, 'the menu bar icon'], [/Tray mode/g, 'Menu bar mode'], [/in the tray/g, 'in the menu bar'], [/tray icon/g, 'menu bar icon'],
  [/트레이 메뉴/g, '메뉴 막대 아이콘'], [/트레이에/g, '메뉴 막대에'], [/트레이 실행/g, '메뉴 막대 실행'],
  [/Ctrl\+click/g, '⌘+click'], [/Ctrl\+클릭/g, '⌘+클릭'],
  [/\bAlt ?\+ ?(drag|끌기)/g, '⌥+$1'], [/\bAlt를 누른 채/g, '⌥(Option)를 누른 채'], [/while Alt is held/g, 'while ⌥ is held'],
  [/C:\\Workspace\\project/g, '~/Projects/project'],
];
export function shortcutText(text, mac = onMac()) {
  if (!mac) return text;
  let s = String(text).replace(/Ctrl\+Shift\+E\b/g, '⌘⇧E').replace(/Ctrl[+ ](F|K|Enter)\b/g, '⌘$1');
  for (const [re, to] of MAC_WORDS) s = s.replace(re, to);
  return s;
}
