// P283: 판 안 링크 열기(터미널, 마크다운 보기). 계산은 lib/links.js(openWith).
// - PC 창: window.open → main의 setWindowOpenHandler가 http(s)만 shell.openExternal(기본 브라우저)로 넘기고 창은 늘 막는다.
// - 원격 웹(휴대폰·태블릿·브라우저): 새 탭(noopener). 누르기 처리기 안에서 바로 불러야 팝업 막기에 걸리지 않는다.
// - http·https가 아닌 주소(file:, 사용자 정의 스킴)는 열지 않고 짧은 알림만 낸다.
import { openWith } from './lib/links.js';
import { toast } from './store.js';
import { t } from './lib/i18n.js';

export function openLink(raw) {
  return !!openWith(raw, {
    open: (href) => { try { window.open(href, '_blank', 'noopener'); } catch {} },
    notify: (scheme) => toast(t('urlLink.notOpened', { scheme })),
  });
}
