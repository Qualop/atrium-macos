const onMac = () => typeof navigator !== 'undefined' ? /mac/i.test(navigator.userAgentData?.platform || navigator.platform || '') : typeof process !== 'undefined' && process.platform === 'darwin';

// 실제로 Command를 지원하는 앱 단축키만 바꾼다. 터미널 제어 키와 Ctrl 드래그는 유지한다.
export function shortcutText(text, mac = onMac()) {
  if (!mac) return text;
  return String(text).replace(/Ctrl\+Shift\+E\b/g, '⌘⇧E').replace(/Ctrl[+ ](F|K|Enter)\b/g, '⌘$1');
}
