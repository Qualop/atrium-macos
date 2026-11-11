// P11: 크롬과 노드의 선 아이콘을 한곳에 모은다(목업 app/design/board-mock/mock.js의 P와 같은 24×24 선 아이콘).
// 색은 currentColor라 부르는 곳의 글 색을 따른다. 굵기와 크기는 styles.css의 .mt-i가 정한다.

export const PATHS = {
  sidebar: 'M3 3h18v18H3zM9 3v18',
  folder: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z',
  chevDown: 'm6 9 6 6 6-6',
  chevUp: 'm18 15-6-6-6 6',
  plus: 'M5 12h14M12 5v14',
  minus: 'M5 12h14',
  x: 'M18 6 6 18M6 6l12 12',
  gear: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
  pointer: 'M5 3l6.5 17 2.4-7.1L21 10.5z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  terminal: 'M4 17l6-6-6-6M12 19h8',
  note: 'M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5zM15 3v6h6',
  kanban: 'M3 3h18v18H3zM9 3v18M15 3v18M5.5 7h1.5M11.5 7h1.5M11.5 11h1.5M17.5 7h1.5',
  link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
  expand: 'M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7',
  flower: 'M12 6.2a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 21.8a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.2 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5.2 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18.8 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  repeat: 'm17 2 4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  archive: 'M3 3h18v5H3zM5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8M10 12h4',
  arrowUp: 'M12 19V5M5 12l7-7 7 7',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  layers: 'M12 2 2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5',
  more: 'M4 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M11 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0M18 12a1 1 0 1 0 2 0a1 1 0 1 0-2 0', // P71: 점 셋(⋯). 길이 0.01 선은 작은 크기에서 거의 안 보여 반지름 1 원으로 그린다
  moon: 'M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z', // P21: 잠든 세션
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  pen: 'M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z',
  file: 'M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5zM14 2v6h6M8 13h8M8 17h8',
  arrange: 'M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z',
  git: 'M6 3v12M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 9a9 9 0 0 1-9 9',
  power: 'M12 2v10M18.4 6.6a9 9 0 1 1-12.77.04',
  spot: 'M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', // P85: 작업 중만 또렷하게
  chev: 'M9 6l6 6-6 6', // P103: 사이드바 펼침 화살표(펼치면 90도 돈다)
  foldAll: 'M7 4l5 5 5-5M7 20l5-5 5 5', // P103: 모두 접기(화살 둘이 안으로)
  unfoldAll: 'M7 9l5-5 5 5M7 15l5 5 5-5', // P103: 모두 펼치기(화살 둘이 밖으로)
};

export function Icon({ name, className = '', title }) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg className={`mt-i ${className}`} viewBox="0 0 24 24" aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}>
      {title && <title>{title}</title>}
      <path d={d} />
    </svg>
  );
}

// Atrium 로고(명령 입력 왼쪽). 그림은 assets/brand(원본 app/design/brand)
export const BRAND_ICON = 'assets/brand/atrium-icon.svg';
export const BRAND_WORDMARK = 'assets/brand/atrium-wordmark.png';
export function Mark() {
  return <img className="mt-mark" src={BRAND_ICON} alt="" aria-hidden="true" draggable={false} />;
}
