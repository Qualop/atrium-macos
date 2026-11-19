// P141(#17): 판이 정한 기본 역할 이름. 백엔드(branch.mjs DEFAULT_ROLE·HEAD_ROLE)는 한국어 낱말로 저장하고
// 에이전트에게도 그 말로 알린다. 화면에 보일 때만 지금 언어로 바꾼다(사람이 --role로 준 이름은 그대로)
import { t } from './i18n.js';

export const BOARD_ROLES = { '워커': 'roles.worker', '헤드': 'roles.head', '동료': 'relations.peerRole' }; // P156: atrium child --peer의 기본 역할
export const shownRole = (role) => (role && BOARD_ROLES[role] ? t(BOARD_ROLES[role]) : role);
