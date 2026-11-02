# 시험 요령

개발과 시험에 쓰는 판, 환경 변수, 정리 순서, 시험 도구의 함정을 적는다. 지켜야 할 원칙은 `CLAUDE.md`에 있고, 이 문서는 그 원칙을 지키는 방법이다.

## 개발용 판

- 백엔드를 개발하고 시험할 때는 `atrium --dev`(`backend/bin/atrium.mjs`, 옛 이름 `mtask`도 같다. herdr 세션 `atrium-dev`, 포트 47811, 데이터 폴더 `backend/.dev/`)를 쓴다. 실제 판의 값(`atrium`, 47800, `%LOCALAPPDATA%\atrium`)과 옛 실제 판(`multitask`)으로는 띄우지 않는다. 개발용 기본 판은 데이터 폴더가 그대로이고 herdr 세션만 `atrium-dev`로 바뀌었다. 옛 `multitask-dev` 서버가 돌면 같은 대화를 두 번 이어 가지 않도록 백엔드가 뜨지 않는다.
- 창은 `cd app && npm start`(개발용 프로필)로 띄운다. 창은 백엔드가 없으면 띄우고, 백엔드는 herdr 서버가 없으면 띄운다.
- herdr 서버는 `CLAUDECODE`, `CLAUDE_CODE_*` 같은 부모 Claude Code 환경 변수를 뺀 환경으로 띄운다. 백엔드가 띄우면 저절로 그렇게 된다.
- 기본 개발용 판에 사용자가 직접 띄운 세션이 있으면, `--dev`에 환경 변수 `ATRIUM_HERDR_SESSION`, `ATRIUM_PORT`, `ATRIUM_DATA_DIR`(창은 `ATRIUM_APP_USERDATA`도)를 더해 herdr 세션 이름, 포트, 데이터 폴더를 바꾼 판에서 시험한다. 창 시험 스크립트가 그 값을 강제하게 한다(`app/test/e2e/p5-lib.mjs`). 다른 창 시험은 환경 변수가 없으면 기본 개발용 판에 붙는다.
- 작업자에게 일을 나눠 맡길 때는 작업자마다 이 네 값을 따로 준다(예: herdr 세션 `atrium-dev-p8`, 포트 47820). 환경 변수는 옛 이름 `MTASK_*`도 받고 둘 다 있으면 `ATRIUM_*`가 이긴다. 시험 막이(`app/test/e2e/p9-guard.mjs`)는 옛 시험 판 이름 `multitask-dev-<이름>`도 받는다.
- 실제 판 프로필로 띄우는 시험이 판 값을 덮으면 옛 판 옮기기는 일어나지 않는다. 옮기기를 시험할 때만 `ATRIUM_LEGACY_HERDR_SESSION`, `ATRIUM_LEGACY_DATA_DIR`, `ATRIUM_LEGACY_APP_USERDATA`로 시험용 옛 판을 주고 `assertLegacyTestBoard`로 막는다(`app/test/e2e/p18-migrate.mjs`).
- 사용자 세션이 든 개발용 `board.db`는 복사해 쓰지 않는다. 판의 복구가 그 세션을 이어 갈 수 있다.

## 시험 끝의 정리 순서

1. 시험 세션을 끈다(`atrium kill <이름> --yes`). 판 밖 프로세스는 직접 띄운 것만 PID로 끈다.
2. 창을 먼저 닫는다. 열린 창은 꺼진 백엔드를 다시 띄운다.
3. 트레이 상주를 켜고 시험했으면 `atrium settings set tray off`(또는 트레이 메뉴의 끝내기)로 앱(Electron main)을 끝낸다. 켠 채로 창을 닫으면 앱이 남는다.
4. 루프 시험은 횟수를 작게, 주기를 짧게 두고, 끝나면 `atrium loop rm`으로 모두 지운다.
5. herdr 서버와 백엔드를 멈추고 그 herdr 세션을 지운다. 단, 그 판에 사용자가 직접 띄운 세션이 있으면 서버를 끄지 말고 사용자에게 알린다(서버를 끄면 그 세션도 끝난다).
6. 임시 워크트리에 `node_modules` 정션을 걸었으면, 워크트리를 지우기 전에 정션부터 끊는다. 정션째로 지우면 원래 `node_modules`의 내용이 지워질 수 있다.

## 시험 자료와 개인 정보

- 판은 사용자의 실제 Claude Code 대화 기록(`~/.claude/projects`)을 읽는다. 시험 판에는 새로 만든 폴더만 워크스페이스로 연다. 이 저장소와 사용자의 다른 프로젝트는 열지 않는다. 그래야 실제 대화 제목과 내용이 스크린숏과 로그에 남지 않는다.
- 판 밖 대화 목록 시험은 `ATRIUM_CLAUDE_PROJECTS`(`;`로 여럿)로 고정 자료를 더한다. 판으로 열기 시험은 시험용으로 새로 만든 대화로만 한다.
- missed 지우기 시험은 고정 자료 복사본으로만 한다. 지우기는 휴지통으로 가므로 시험 뒤 휴지통에 고정 자료가 남는다. 시험 판은 `ATRIUM_TEST_PREFIX`(시험 폴더 접두어, 기본 `mtask-`), `ATRIUM_CLAUDE_SESSIONS`(도는 중 판정에 쓰는 세션 파일 폴더), `ATRIUM_CODE_ROOT`(판 코드 저장소)로 고정 자료에 맞춘다(`experiments/p13/tools/`).
- 시험 프로젝트 폴더는 신뢰된 폴더 아래에 두되 따로 `git init`하지 않는다. 따로 git 저장소로 만들면 신뢰 대화상자가 뜨고, 신뢰는 대신 누르지 않으므로 시험할 수 없다. 신뢰 대화상자가 필요한 시험은 사용자 점검표로 돌린다.

## 창 시험(`app/test/e2e/`)

- 결과 폴더(`MT_E2E_OUT`)와 판 고르기(`MT_E2E_BOARD`)는 명령줄 환경 변수로 준다. 시험 도구가 `harness.mjs`를 불러온 뒤에 바꾸면 늦다.
- 시험 판의 CLI는 `experiments/p6c/tools/mt.cjs`처럼 환경 변수를 넣는 감싸개로 부른다. 셸의 `source`와 변수로 만든 명령은 Claude Code 워크트리에서 막힌다.
- 옛 단계의 창 시험을 다른 판에서 다시 돌릴 때는 `experiments/p11/tools/e2e.cjs <시험 파일>`처럼 판 값과 `MT_E2E_BOARD`, `MT_E2E_OUT`을 넣어 시험을 부르는 감싸개를 쓴다. 각 lib는 `app/test/e2e/p11-board.mjs`로 판 값을 바꾼다. 그 `env.cjs`는 옛 이름 `MTASK_*`로 적혀 있어 `atriumEnv`로 바꿔 넣는다. `p12-quick`, `p14-tray`, `p15-close`는 `MT_E2E_HERDR_SESSION`, `MT_E2E_PORT`, `MT_E2E_DEV`, `MT_E2E_DIR`로 판 값을 덮어 다른 판에서 돌린다.
- 창 크기에 기대는 시험(`p10-dock.mjs` 등)은 창 안쪽을 그 단계 때 크기(P10은 1584×921)로 맞추고 돌린다. 최소 크기 창에서는 덩어리가 다 들어가지 않는다.
- 내 차례 줄(`.mt-chip.need`)은 위 오른쪽 `[data-role="inbox"]`를 눌러야 보이고, 영역 이름표의 단추(`[data-action=arrange]` 등)는 이름표에 마우스를 올려야 보인다.
- 노드를 끌 때는 시작과 끝 자리가 함께 화면 안쪽에 오게 먼저 맞춘다. 끄는 점이 캔버스 가장자리에 닿으면 React Flow가 화면을 저절로 밀어 노드를 더 멀리 옮긴다.
- 스크린숏과 로그는 `experiments/p<번호>/`에 둔다.

## herdr를 부르는 시험

- 시험 에이전트가 부르는 `herdr` 명령에 `--session`, `--machine`, `--remote`를 쓰게 하지 않는다. 판이 띄운 패널의 `herdr`는 herdr가 넣는 `HERDR_SESSION`·`HERDR_SOCKET_PATH`로 판 전용 세션에 붙는다.
- herdr 소켓 API의 `pane.split`은 `target_pane_id`로 대상을 준다. 빼면 초점 패널(사용자 세션일 수 있다)을 나눈다.

## 단위 시험

- 백엔드: `cd backend && npm test`
- 창: `cd app && npm test`, 빌드는 `npm run build`
- macOS 통합: `cd app && npm run test:mac`, 확장 검증은 `npm run test:mac:stress`. 새 `/tmp` 폴더·포트·herdr 세션만 쓰며 종료 시 정리한다. `ATRIUM_SMOKE_AGENT=1`이면 새 Claude CLI 시작 화면도 확인한다. 신뢰는 수락하지 않는다. 설치는 `npm run setup:mac`.
