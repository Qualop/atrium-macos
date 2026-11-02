// 한국어 UI: 공통 상태, 세션 관리, 프로젝트 관리, 선택 항목별로 유지한다.
import core from './ko-core.js';
import sessions from './ko-sessions.js';
import workspace from './ko-workspace.js';
import controls from './ko-controls.js';

export default {
  ...core,
  ...sessions,
  ...workspace,
  ...controls,
  thread: { ...sessions.thread, title: '요청 기록' },
};
