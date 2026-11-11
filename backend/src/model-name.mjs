// P96: 모델 이름 검사 한 곳. 호출자(launchers.mjs), 하위 세션(branch.mjs), Codex 모델 목록(codex-models.mjs)이 같은 글자를 쓴다.
// 글자: 영문·숫자·._:/[]-. 슬래시는 opencodex·게이트웨이 모양 이름(deepseek/deepseek-flash, b.ai/glm-5.3-flash)에 든다.
// 명령줄에는 argv 배열로 넘기고(herdr agent.start), 이 글자에는 셸이 따로 읽는 것이 없다. Bash에서 [ ]는 models.mjs가 따옴표로 묶는다.
export const MODEL_MAX = 512;
// 칸의 글자만(빈 값 = 하네스 기본). 호출자 칸 검사가 쓴다
export const MODEL_RE = /^(?:[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]{0,511})?$/;
// 실제로 넘길 이름: 비지 않고, 80자까지, 첫 글자는 영문·숫자(-로 시작해 다른 인자로 읽히지 않게)
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@\[\]-]*$/;
export const isModelName = (m) => typeof m === 'string' && m.length <= MODEL_MAX && NAME_RE.test(m);
