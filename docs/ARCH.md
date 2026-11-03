# Atrium 설계

지금의 구조를 적는다. 왜 그렇게 정했는지는 `docs/decisions.md`, 단계마다 맡긴 지시와 보고는 `docs/log/`에 있다. 코드 주석이 이 문서의 절 번호와 기능 번호(A1, H5 등)를 가리키므로, 번호를 바꾸면 주석도 같이 고친다.

## 1. 프로세스 구조

```
[Electron 창: React, @xyflow/react, xterm.js] ─┬─ WebSocket (127.0.0.1, 토큰)
[시험용 CLI: atrium]                           ─┘          │
                                                           ▼
                  [Atrium 백엔드: Node 24]
                   ├─ herdr 어댑터: 소켓 API(Windows 파이프 / macOS Unix 소켓, 요청마다 연결) + events.subscribe
                   ├─ 화면 중계: 가까이 보이는 노드마다 `herdr terminal session control` 자식 프로세스
                   ├─ hook 수신기(HTTP POST) ← 각 claude의 http hook
                   ├─ 대화 기록 읽기(~/.claude/projects/*.jsonl)
                   └─ SQLite(판 배치, 봤음, 메모, 전달 기록)
                                   │
                                   ▼
                  [herdr 서버: 이름 있는 세션 `atrium`]
                   └─ 작업 공간 × N ─ 패널 ─ claude(또는 다른 종류, 셸)
```

하위 세션 명령은 WebSocket이 아니라 판 포트의 HTTP(`POST /branch/*`)를 쓴다(4절 K1).

**나누는 이유**

1. 창이나 백엔드가 꺼지거나 죽어도 세션은 herdr에서 계속 돈다. 세션의 수명을 화면과 떼어 놓는다.
2. herdr는 터미널 소유, 세션 유지, 서버를 다시 시작할 때 `claude --resume`을 이미 한다(E0). Atrium은 판에만 필요한 기능을 만든다.
3. 판의 API(6절)는 herdr를 드러내지 않는다. herdr 호출은 어댑터 안에만 둔다. herdr를 떠나야 하면 어댑터만 바꾼다.

**herdr 서버 띄우기**

- 판은 이름 있는 전용 세션 `atrium`을 쓴다. `herdr --session atrium server`로 띄우면 서버, 소켓, 작업 공간, 상태 파일이 `%APPDATA%\herdr\sessions\atrium\` 아래에 따로 생긴다. 사용자의 기본 herdr 세션과 섞이지 않는다.
- herdr 서버는 띄운 프로세스의 환경 변수를 패널과 claude에 물려준다. 판은 `CLAUDECODE`, `CLAUDE_CODE_*`, `CLAUDE_PID` 같은 부모 Claude Code 표시 변수를 뺀 환경으로 서버를 띄운다(E0, E1).
- herdr 버전은 0.9.5로 고정한다. 붙을 때 `ping`의 `protocol`(지금 22)과 `capabilities`를 확인하고, 다르면 연결하지 않고 알린다.
- 백엔드는 자기가 뜰 때만 herdr 서버를 띄운다. 도는 중에 herdr가 죽으면 1초마다 다시 붙기만 하고 서버를 스스로 띄우지 않는다. 사람이 일부러 껐을 수도 있어서다.

**설정 값**

| 항목 | 실제 판 | 개발용(`--dev`) |
|---|---|---|
| herdr 세션 이름 | `atrium` | `atrium-dev` |
| 백엔드 포트 | 47800 | 47811 |
| 데이터 폴더 | `%LOCALAPPDATA%\atrium` | `backend/.dev/data`(저장소에서 무시) |
| 창 프로필, 앱 ID | `atrium-app-real`, `atrium.real` | `atrium-app-dev`, `atrium.dev` |

개발용 프로필이 실제 판(옛 이름 `multitask` 포함)의 세션 이름이나 데이터 폴더를 가리키면 백엔드가 뜨지 않는다. 실제 판은 처음 뜰 때 옛 이름의 판을 한 번 옮긴다(5절 이름 옮기기). 이름 없는 기본 herdr 세션은 받지 않는다. 개발용 판을 따로 띄우는 환경 변수는 `docs/testing.md`에 있다.

**백엔드 수명:** Electron 창이 백엔드가 없으면 띄우고, 백엔드는 herdr 서버가 없으면 띄운다. 창이 열려 있는 동안 백엔드 연결이 끊기면 창이 백엔드를 다시 띄운다. 창을 닫아도 백엔드와 herdr는 계속 돈다(트레이 상주는 4절 I7). 창은 같은 프로필로 하나만 뜬다. hook 주소는 세션마다 만든 설정 파일 안에 있고 herdr가 세션을 이어 갈 때 그 파일을 다시 읽으므로(E7), 포트는 고정이고 백엔드는 다시 뜰 때 같은 포트를 쓴다. 백엔드가 꺼져 있는 동안에는 세션 화면에 hook 연결 오류 글이 찍힌다. 포트와 토큰은 데이터 폴더의 파일로 알리고 `127.0.0.1`에만 연다.

**브라우저 탭 웹앱으로 하지 않는 이유:** 전역 단축키, OS 알림, 창 위치와 포커스 관리는 데스크톱 앱이 낫다. 화면 코드는 웹 기술이라, 나중에 같은 화면을 브라우저(휴대폰 포함)에 내보내는 길은 열려 있다.

## 2. 통신 속도

이 PC에서 잰 값(2026-10-29)으로 통신은 병목이 아니다. 지속 연결 왕복은 중앙값 0.036ms, herdr 요청 하나(연결부터 응답까지)는 0.37ms, 글을 넣고 화면 프레임에 나타나기까지 12~46ms, http hook 하나는 중앙값 5ms다. 측정표는 `docs/decisions.md`에 있다. 설계에 남긴 규칙은 넷이다.

- 짧은 시간에 herdr를 수천 번 부르는 설계는 피한다.
- hook은 http 방식으로 받는다. Claude Code는 hook이 응답할 때까지 기다리므로, 수신기는 토큰을 확인하고 먼저 200으로 응답한 뒤 처리한다. 설정 파일의 hook 시간 제한은 2초다.
- 화면은 가까이 보이는 노드에만 보낸다. 노드마다 제어기 프로세스(약 17MB)가 붙는다.
- 화면 글자를 긁어 상태를 정하지 않는다. 상태는 herdr 상태와 hook으로, 내용(마지막 답, 지시, 도구 사용)은 hook 입력과 대화 기록으로 얻는다. 화면 읽기(`pane.read`)는 요약 얼굴, 시작 대화상자 확인, 권한 요청 선택지 읽기, hook이 없는 세션의 답과 셸 상태에만 쓴다.

## 3. 세션 상태 모델

판이 띄운 세션의 상태는 아래 일곱 가지다. 패널 상태는 herdr 상태를 기준으로 하고, hook은 상세와 오류를 더한다. Gemini CLI는 제출·완료 hook을, Antigravity는 도구 hook·native 답변 기록을 더한다. 그 밖의 세션은 herdr 상태로 정하고, 셸은 따로 `shell_idle`, `shell_running`이다(4절 G2).

| 상태 | 뜻 | 들어오는 신호 |
|---|---|---|
| starting | `agent.start`를 불렀고 아직 준비 전 | `agent.start` 응답(`launch_pending`). herdr 서버를 다시 띄운 뒤 약 5초 동안의 `unknown`도 starting으로 본다(E7) |
| trust_wait | 처음 쓰는 폴더라 Claude Code가 신뢰 대화상자를 띄움 | 띄우기 전에 `~/.claude.json`의 `projects`에서 `hasTrustDialogAccepted`를 읽어 예상한다(키는 슬래시 경로, 읽기만 한다). 폴더에서 위로 올라가며 찾되, git 저장소 안이면 저장소 루트에서 멈춘다(E10). 띄운 뒤에는 herdr `blocked`인데 묻는 hook이 없고 화면에 "Quick safety check"가 있으면 trust_wait다. `agent.get`의 `launch_pending: true`와 `agent_session` 없음은 보조 신호이고, `resume_argv`를 등록하면 깨지기 쉽다 |
| ready | 입력을 기다림 | herdr `idle` 또는 `done` |
| working | 턴을 도는 중 | herdr `working`. hook `UserPromptSubmit`, `PostToolUse`가 0.2~0.3초 먼저 온다 |
| waiting | 내 답이 필요함 | herdr `blocked`와 함께 hook `PermissionRequest` 또는 `PreToolUse`(`AskUserQuestion`, `ExitPlanMode`)가 있을 때. 무엇을 묻는지는 이 hook으로 받는다. `Notification`(`permission_prompt`)은 늦게 오는 보조 신호다(E2, E9) |
| error | 턴이 실패함(프로세스는 살아 있음) | hook `StopFailure`(오류 종류: `rate_limit`, `overloaded`, `authentication_failed` 등). herdr 상태에는 오류가 없다 |
| exited | claude가 끝남 | hook `SessionEnd`, 그 뒤 herdr `pane_agent_detected(released: true)`와 상태 `unknown`. 패널은 셸로 돌아가 남는다. `reason`이 `prompt_input_exit`면 정상 종료, `other`와 herdr 소켓 끊김이 함께 오면 "herdr가 꺼짐"이다(E7). 신뢰 대화상자에서 거절해 끝나면 hook 없이 해제 이벤트만 오고 "신뢰하지 않아 끝남"으로 보인다(E10) |

규칙:

- `SessionStart`는 http hook으로 오지 않는다(E2). 시작 직후의 ready는 herdr `idle`로 잡는다.
- `SubagentStop`은 상태를 바꾸지 않는다. Claude Code 내부 보조 에이전트도 이 이벤트를 낸다.
- herdr 상태와 hook이 어긋나면 화면에 추정 표시를 한다. herdr는 모르는 대화상자를 `idle`로 판정할 수 있다.
- herdr `blocked`만으로 waiting을 정하지 않는다. 묻는 hook이 있으면 waiting, 없고 화면에 "Quick safety check"가 있으면 trust_wait, 둘 다 아니면 "알 수 없는 대화상자"로 화면을 보여준다.
- waiting은 hook이 아니라 herdr 상태가 `blocked`에서 `working`이나 `idle`로 바뀔 때 끝낸다. 거부, 질문 취소, "Chat about this"에는 `PostToolUse`가 오지 않는다(E9).
- 권한 상세에서 `Bash`와 `PowerShell`은 같은 부류로 다룬다.
- hook 본문의 `permission_mode`(`default`, `acceptEdits`, `plan`)를 세션 상세에 둔다.

덧붙이는 표시:

- **검토 대기(unseen):** ready가 된 시각이 사용자가 그 세션을 마지막으로 본 시각보다 늦다. 판은 여러 노드를 동시에 보여주므로 herdr의 `done`(초점 패널만 봤음) 대신 자체 봤음 기록을 쓰고, herdr의 `done`과 `idle`은 둘 다 ready로 본다. 노드를 누르거나 칩·`N`으로 그 세션에 가면 봤음이다.
- **조용함(quiet):** working인데 출력과 hook이 일정 시간 없다(기준 시간은 PLAN 열린 결정).
- **전달 중(delivering):** 보낼 메시지가 대기열에 있다.
- **끊긴 턴:** herdr가 다시 뜨기 직전 working·waiting이던 세션, 셸에서 돌던 명령(4절 C3, I8).

## 4. 기능

판이 하는 일을 기능 번호별로 적는다. 처음 정한 시나리오의 전문과 만들며 정한 세부는 `docs/decisions.md`의 "기능 시나리오"에 있다.

### A. 알아차리기

- **A1 내 답이 필요하다.** herdr `blocked`와 묻는 hook으로 waiting을 정하고 도구·명령이나 질문·선택지를 붙인다. 위 오른쪽 "내 차례 n" 알약의 펼침 목록이 모든 워크스페이스를 가로질러 오래 기다린 순서로 보이고, `N`으로 노드를 옮기지 않고 그 자리로 간다. OS 알림은 1.2초 기다렸다가 정하고, 같은 대기(`tool_use_id`)에 한 번만, 창에 초점이 있고 그 노드가 보이면 띄우지 않는다. 누르면 그 노드로 간다. 승인 줄은 `agent.send_keys`로 숫자 키를 보낸다(거부는 `esc`, 지시 덧붙이기는 `tab`, 글, `enter`). 질문 선택지는 hook에서, 권한 선택지는 화면에서 읽는다. 보내기 직전에 `agent.get`으로 아직 막혀 있는지 확인하고, 풀렸으면(`stale`, `no_pending_ask`) 줄을 닫고, hook만 먼저 왔으면(`not_blocked`) 줄을 둔다. "Chat about this"류는 "터미널에서 답하기"로 보내고, 판은 `ctrl+g`(외부 편집기)를 보내지 않으며 노드 터미널의 `ctrl+g`도 막는다. 키 순서는 `backend/src/answer.mjs`에 있다.
- **A2 검토 대기.** hook `Stop`의 `last_assistant_message`, 턴 시작과 끝 시각, 세션 폴더가 git 저장소면 `git diff --stat`.
- **A3 복귀 요약.** 모든 상태 변화를 판 이벤트로 남기고, `changes.since`가 판을 마지막으로 본 뒤의 변화를 "세션 × 종류" 한 줄로 모은다. 판을 본 시각은 창에 초점이 있는 동안 30초마다와 떠날 때 남기고(`board.markSeen`), 돌아왔을 때 5분 넘게 지났고 바뀐 것이 있으면 연다.
- **A4 조용함.** 세션별 마지막 상태 이벤트와 hook 시각, `pane.read`의 마지막 줄.
- **A5 실패와 종료.** `StopFailure`의 오류 종류, `SessionEnd`와 herdr 해제 이벤트, 화면 꼬리, 이어 갈 수 있는지(세션 ID와 대화 기록 파일).

### B. 말 걸기와 시작하기

- **B1 `@이름`으로 말 걸기.** 세션마다 전달 대기열이 있고, 한 세션이 응답을 기다려도 다른 세션은 막지 않는다. 규칙: (1) claude가 도는 패널에만 보낸다. (2) waiting이면 보내지 않고 풀리면 다시 보낸다(최대 15분). (3) starting, trust_wait, working에서는 보내지 않고 ready와 error에서만 보낸다. (4) 사람이 그 터미널에 3초 안에 입력했으면 기다린다. (5) 줄바꿈을 LF로 맞춰 `agent.prompt` 한 번으로 보낸다(괄호 붙여넣기, 한글 그대로, 100KB까지 한 턴). `pane.send_text`로 넣을 때는 CR을 넣지 않는다. (6) hook `UserPromptSubmit`이 오면 제출 확인, 30초 안에 없으면 "확인 못 함"이다. 비교 전에 Claude Code가 긴 글에 씌우는 `<pasted_content>` 감싸기를 벗기고 CRLF, 탭, 양끝 공백을 맞춘다(`backend/src/text.mjs`). 대화 보기에서도 감싸기를 벗긴다.
- **B2 여러 세션에.** 대상은 `@이름`(여럿 가능)과 `@all`(H8)이다. 여러 대상 중 셸이 하나라도 있으면 전체를 보내지 않는다. 일을 나눠 서로 다른 지시를 쓰는 것은 에이전트가 herdr 스킬로 한다.
- **B3 새 세션 시작.** (1) 세션 설정 파일 `<데이터 폴더>\sessions\<세션 ID>.json`에 http hook(시간 제한 2초), 그 세션의 hook 토큰, 하위 세션 명령의 env와 승인 규칙(K)을 값으로 쓴다. 작업 공간 `env`는 herdr를 다시 띄우면 되살아나지 않는다(E7). (2) `workspace.create`. (3) `agent.start`에 `--session-id <새 UUID>`, `--settings`, `--no-chrome`, 권한 모드, 모델, 플러그인과 짧은 안내(F). (4) ready(또는 working, waiting, error)가 된 뒤 `pane.report_agent_session`으로 `resume_argv`(판의 인자 포함, 경로는 슬래시)를 등록하고, 거부되면 1초마다 다시 시도하며, 판 전용 세션의 `session.json`에서 저장을 확인한다(읽기만). (5) 첫 지시는 ready 뒤 B1로 보낸다. 처음 쓰는 폴더면 trust_wait를 미리 보이고, 신뢰는 대신 누르지 않는다. `claude`는 PATH에 있어야 한다. 설정 파일은 세션이 판에 있는 동안 지우지 않고 D2에서 지운다. 받지 않은 모델, 노력 수준, 권한 모드, herdr 자동 승인, 다른 종류의 실행 인자는 설정의 새 세션 기본값(I7)으로 채운다.

### C. 복구

- **C1 창을 껐다 켬.** 세션은 herdr에서 계속 돈다. 창이 다시 붙으면 배치를 받고 가까이 보이는 노드에 제어기를 다시 붙인다. 첫 프레임 하나로 화면이 칸 단위까지 돌아온다.
- **C2 백엔드 재시작.** 같은 포트로 다시 연다. `session.snapshot`과 `agent.list`로 세션을 다시 읽고 herdr 현재 상태로 맞추며, 놓친 hook(마지막 답 등)은 대화 기록에서 읽는다.
- **C3 herdr 재시작과 재부팅.** herdr 서버가 끝나면 그 서버의 claude도 함께 끝난다. 다시 띄우면 herdr가 작업 공간, 패널 ID, 에이전트 이름을 되살리고 등록된 `resume_argv`로 이어 간다. 다시 뜬 뒤 약 5초는 starting으로 보고, 그 직후 `agent.list`의 `idle`은 믿지 않는다. 재시작 직전 working·waiting이던 세션은 "끊긴 턴"으로 표시하고 대화 기록 꼬리를 보인다. 한 턴도 돌지 않은 세션(대화 기록 없음)은 같은 `--session-id`와 설정 파일로 새로 띄우고, 대화 기록이 있는데 이어 가기가 실패하면 exited로 둔다. herdr가 `session.json`을 늦게 저장해 잃은 작업 공간은 판이 되살린다(J1). 백엔드가 꺼진 동안의 재시작은 저장한 herdr 서버 PID로 알아챈다. 창은 다시 뜬 세션에 터미널을 다시 붙이되, 다른 클라이언트가 가져간 패널은 빼앗지 않는다.

### D. 자원과 안전

- **D1 자원.** `pane.process_info`로 셸 PID를 얻고, Windows 프로세스 표(Win32_Process)에서 셸 아래 프로세스의 메모리를 약 30초마다 더한다. 붙어 있는 제어기 수와 상한(기본 8)도 보인다.
- **D2 끄기.** `/exit`(다른 종류는 `ctrl+c` 두 번)를 보내고, 같은 작업 공간에 다른 패널이 있으면 `pane.close`, 없으면 `workspace.close`. 판 전용 herdr 세션의 패널만 닫고 `claude.exe`를 이름으로 끄지 않는다. 세션 설정 파일도 이때 지운다. 되돌릴 수 없는 명령은 `confirm` 없이 부르면 확인 문구만 돌려준다. 확인에서 Delete를 한 번 더 누르면 삭제를 고르고 Enter로 확정한다. 노드의 X나 고른 노드(머리줄을 누르면 고르기만 한다)의 Delete는 보관, 삭제, 취소를 묻는다(`after`, 여럿이면 한 확인창). 보관은 끈 세션을 보관함에 두고, 삭제는 대화 기록과 옆 폴더를 휴지통으로 보내고 닫힌 세션 행(노드 자리, 선, 보관 표시)을 지운다. 그 대화가 아직 도는 등 지우지 못하면 보관한다.
- **D4 잠재우기.** 리포(워크스페이스)에 정한 시간(기본 30분) 동안 아무 일이 없으면 그 리포의 판 claude를 모두 `/exit`하고 패널까지 닫아 잠듦(`sleeping`)으로 둔다. 리포의 어떤 세션이든 일하는 중, 내 차례, 보는 중, 손댐, 전달 대기, 보내지 않은 초안, 루프가 있으면 그 리포는 잠들지 않는다. 잠든 리포의 노드를 누르거나 그 리포에 글을 보내면(herdr 호출 포함) 리포 전체를 같은 대화로 차례로(1.5초 간격) 깨우고, J1 복구는 잠든 세션을 건너뛴다. 손으로는 영역 이름표 메뉴와 트레이·메모리 목록의 "쉬는 리포 모두"로 한다.
- **D3 herdr 화면이 붙음.** herdr 화면(TUI)과 판의 제어기는 패널 크기를 두고 다툴 수 있다. 소켓 API에는 클라이언트 목록이 없어서 판 전용 세션의 서버 로그(`herdr-server.log`)와 `herdr.exe` 명령줄로 알아채 경고한다. 로그 형식은 herdr 버전에 묶여 있다.

### E. 다시 들어가기

- **E2 브리핑.** 30분 넘게 손대지 않은 세션으로 돌아오면 마지막 지시(Claude Code의 표시 줄은 건너뜀), 마지막 답, 지금 상태, 기다리는 질문을 먼저 보인다. "손댐"은 그 세션을 보거나, 터미널에 입력하거나, 글을 보내거나, 카드로 답한 것이다. 데스크톱 앱 세션(E1)과 기본 herdr 세션(E3)은 보여주지 않는다.

### F. 세션끼리 연결

판은 백엔드가 뜰 때 `<데이터 폴더>\plugin\atrium-herdr\`에 플러그인을 만들고, 판이 띄우는 claude마다 `--plugin-dir`로 넘긴다. 플러그인에는 herdr 스킬(고정한 herdr의 `herdr --skill` 출력), 일 맡기기 스킬(K2), 하위 세션 명령 `bin/atrium`과 별칭 `bin/mtask`(K1)가 있다. 짧은 안내(`--append-system-prompt-file`)는 herdr 스킬을 쓰라는 것, herdr 명령에 `--session`·`--machine`·`--remote`를 붙이지 않는다는 것, `[Atrium 판]` 글은 판의 알림이라는 것, 하위 세션은 `atrium child`로 만든다는 것을 알린다. `resume_argv`에도 같은 인자가 들어간다.

- **F1 일 시키기를 선으로.** 판이 띄운 Claude Code의 `PreToolUse`·`PostToolUse`(Bash, PowerShell) hook에서 `herdr agent prompt`, `herdr pane run`, `herdr agent start`, `herdr pane split` 명령 글을 읽어 "연결"과 "오간 일"로 저장한다. `PostToolUse` 결과로 전달 끝과 읽은 답도 얻는다. 받는 쪽 상태와 새로 나타난 에이전트는 herdr 이벤트로 본다. 명령 치환, 변수에 담은 대상, 스크립트 안의 호출은 풀지 못한다. 다른 곳을 부른 호출은 선 없이 판 이벤트(`herdr_foreign_call`)로 남기고, 대상이 아직 판에 없으면 120초 기다린다.
- **F2 판에서 잇기.** 순서 있는 두 세션 쌍마다 연결 하나(표 `links`, `link_events`). 판에서 A → B를 잇고 역할을 정하면 A에게 B의 herdr 이름, 패널, 역할과 일 시키기·답 읽기 명령을 B1로 알린다. 끊을 때 확인을 받고 끊겼다고 알리며, B의 패널 ID가 바뀌면 새 패널을 알린다. 오간 기록은 끊어도 남는다. 알림 글은 `backend/src/links.mjs`에 있다.
- **F3 판에 올리기.** 판 전용 herdr 세션에 판이 모르는 에이전트가 나타나면(`pane.agent_detected`) 판에 올리고, 띄운 세션(hook에서 본 띄운 명령, 없으면 같은 작업 공간의 판 세션)과 잇는다. hook이 없으므로 F5처럼 다룬다. 에이전트가 herdr로 직접 띄운 에이전트는 그 하네스의 사용자 설정을 따르고, 판의 설정을 받는 하위 세션은 K로 만든다. 끌 때 같은 작업 공간에 다른 패널이 있으면 그 패널만 닫는다.
- **F4 워크트리.** 판은 워크트리를 만들지 않고 규칙도 정하지 않는다. hook의 `cwd`와 git 조사(`rev-parse --git-dir --git-common-dir`)로, hook이 없으면 herdr `pane.get`의 `foreground_cwd`를 15초마다 보아 노드에 워크트리 경로와 브랜치를 보인다. 같은 저장소 선은 워크트리 세션마다 하나만 긋는다.
- **F6 DeepSeek.** 왼쪽 레일의 DeepSeek는 판이 띄우는 Claude Code(`flavor: deepseek`)이고, 세션 설정 파일 env로 로컬 opencodex 프록시(`ANTHROPIC_BASE_URL`, 기본 127.0.0.1:10100)에 붙여 DeepSeek 모델(기본 `ocx-claude-deepseek--deepseek-flash[1m]`)을 쓴다. 프록시 health가 아니면 띄우지 않는다(`deepseek_proxy_down`). 설정의 직접 명령이 있으면 셸 패널에 그 명령을 치고 G2로 hook 없는 에이전트가 된다(`deepseek.mjs`).
- **F5 다른 종류.** `agent.start { kind }`로 띄우고 hook, 이어 가기 등록, 신뢰 예상 없이 실행 인자를 넘긴다. 보낸 뒤 herdr `working`이면 제출 확인이고, 마지막 답은 턴이 끝날 때 `pane.read recent_unwrapped`에서 고른다(`answerSource: screen`). 판의 답하기 API는 `answer_in_terminal`로 거부한다. 종류 목록은 `herdr agent` 도움말의 `kinds:` 줄과 `where.exe`로 찾고, 깔린 것만 고를 수 있다.

### G. 워크스페이스와 일반 셸

- **G1 워크스페이스.** 세션의 워크스페이스 키는 시작 폴더의 git 공통 폴더(`git rev-parse --path-format=absolute --git-common-dir`, 역슬래시·끝 슬래시·대소문자를 맞춤)다. 워크트리도 본 저장소와 같은 키이고, git이 아니면 그 폴더다. 판에 올린 에이전트와 셸은 패널 폴더로 정한다. 세션이 다른 저장소로 `cd`해도 옮기지 않고 "다른 저장소에서 일하는 중"만 표시한다. 세션이 생기면 워크스페이스가 저절로 생기고 "+ 리포 열기"로 빈 워크스페이스도 만든다. 비어 있을 때만 닫는다(`not_empty`). 이름은 저장소 폴더 이름(겹치면 `부모/이름`)이다. 옛 판은 뜰 때 `backend/src/migrate.mjs`가 옮긴다. herdr의 "작업 공간"과는 다르다.
- **G2 일반 셸.** 판 전용 herdr 세션의 모든 패널(`pane.created`, `pane.closed`, `pane.exited`, `pane.agent_detected`, 다시 맞출 때 `pane.list`)이 노드다. 에이전트가 없으면 종류 `shell`이고, 나중에 에이전트가 나타나면 같은 노드의 종류만 바뀌며, 판이 띄우지 않은 에이전트가 끝나면 셸로 돌아간다. 셸은 2초마다 화면 끝 줄이 프롬프트인지로 쉬는지 보고, 명령 글은 마지막 프롬프트 줄에서, 프로세스 이름은 셸 PID의 자식에서 얻는다. 셸에는 hook과 승인 줄이 없고 글을 보내지 않는다(`not_agent`). 새 세션 대화상자의 "셸(PowerShell)"은 `workspace.create`만 한다.
- **G4 가로지르기.** 내 차례, 검토 대기, 문제 칩, OS 알림, `N`은 모든 워크스페이스를 가로지른다. 자원 표시와 D3 경고는 판 전체 기준이다.

### H. 단일 캔버스와 관계 표현

- **H1 한 캔버스와 영역.** 모든 워크스페이스의 세션이 캔버스 하나에 있다. 워크스페이스마다 영역(배경과 이름표: 이름, `⎇`/`▢`, 세는 값)이 안의 노드, 덩어리, 메모, 칸반을 감싸도록 저절로 커지고 줄어든다. 이름표를 끌면 안의 것이 함께 움직이고(`workspace.move`), 영역끼리 겹치게 놓으면 되돌린다. 새 세션은 그 영역 안이나 바로 옆 빈자리, 새 워크스페이스는 겹치지 않는 빈자리에 생긴다. 영역 계산과 빈자리는 순수 함수(`backend/src/canvas.mjs`, 창도 같이 씀)다. 뷰포트는 캔버스 하나에 하나다.
- **H2 바로 가기.** 위 왼쪽 워크스페이스 탭(세는 값)과 찾기(`Ctrl+F`, 터미널 안에서도). 검색(`search.query`)은 판 기록의 이름, 워크스페이스, 기다리는 질문, 마지막·지난 요청과 답, 받은 지시, 메모 노드, 칸반, hook 없는 세션의 화면 답에서 찾아 세션마다 가장 잘 맞은 것 하나를 준다. 대화 기록 파일 전체는 뒤지지 않는다.
- **H3 오버뷰.** 멀리 얼굴(7.2)에 이름, 상태, 기다리는 질문(가장 크게), 마지막 요청, 마지막 답. 캔버스 배율이 작아도 읽히도록 글자 크기를 화면 기준으로 두고, 더 작으면 기다리는 노드 위에 말풍선을 띄운다. 기다리는 노드는 테두리가 깜빡이고 오래 쉬는 노드는 흐리다.
- **H4 바로 들어가기.** 노드를 어디든 누르면 그 노드(덩어리 안이면 덩어리 전체)가 화면의 85% 안에 들게 옮기고 확대한다(배율 상한 1, 이미 보고 있으면 그대로). 머리줄은 고르기만 하고, 본문은 터미널에 초점을 준다. 터미널이 붙기 전에 친 키는 창이 모았다가 넣는다.
- **H5 붙여 묶기.** 두 노드 이상을 틈 없이 붙인 덩어리. 덩어리는 tmux·herdr 창 분할 같은 분할 나무다(P17, `dock-tree.mjs`): 마디는 가로(왼쪽|오른쪽)나 세로(위/아래) 분할과 자식 비율, 잎은 세션 노드이고, 바깥 직사각형(구성 노드의 bbox)을 비율대로 채운다(잎마다 최소 240×160). `Ctrl`+끌기로 다른 노드 위에 가져가면 놓일 자리를 보인다. 노드의 가장자리 쪽이면 그 노드를 반으로 나누고(`at: leaf`), 덩어리 바깥 가장자리 쪽이면 덩어리 옆 새 칸(`at: dock`, 덩어리가 그만큼 커진다), 아무 데도 아니면 뗀다. 그냥 끌기로 혼자인 노드를 덩어리 바깥 가장자리 가까이 놓아도 붙는다. 분할선은 마디마다 하나이고 그 마디의 두 쪽만 바꾼다. 잡는 폭은 배율과 상관없이 화면 약 8px, 두 번 누르면 반반이다. 붙은 노드의 바깥 테두리를 끌면 그 쪽으로 덩어리가 커지고 줄며, 2×2처럼 엇갈리는 점의 손잡이는 가로·세로 선을 같이 옮긴다. 오른쪽 아래 손잡이로 바깥 크기를 바꾼다. 고른 노드는 배치 틀(1 + 2, 2 + 1, 2 × 2, 가로·세로 셋, 한 줄)로 한 번에 짠다. 구성 노드 머리줄을 끌면 덩어리째 움직이고 `Alt`+끌기나 메뉴로도 뗀다. 떼거나 닫으면 잎을 빼고 나무를 정리한다(뿌리 칸이면 덩어리가 그만큼 줄고, 안쪽 칸이면 이웃이 채운다). herdr에서 같은 탭에 나뉜 패널은 판에 오를 때 나눈 방향대로 붙인다. 같은 덩어리 안 세션끼리의 연결은 노드 가운데 점을 잇는 진한 선(어두운 테두리)을 세션 위에 겹쳐 보이고(초점 세션 쪽 끝은 그 테두리 가운데), 점은 그 덩어리에 연결이 있을 때와 잇기 모드에서만 보인다(P23). 판의 배치일 뿐 herdr 레이아웃은 바꾸지 않는다. 표 `docks`의 `tree` 열이 나무(JSON)이고, P16까지의 한 줄 행(`dir`, `members`)은 뜰 때 같은 모양의 나무로 바꾼다.
- **H7 크기와 정리.** 노드 크기 단계는 크게, 보통, 작게(`board.setSize`). 고른 노드 막대는 가로|세로 토글과 크게·보통·작게(지금 단계에 불)이고, 덩어리 안 노드면 덩어리 바깥에 쓴다. 배치 틀은 세션 수(2~6, 7 이상)마다 따로다. "정리"(`board.arrange`, 사람이 누를 때만)는 연결을 따라 시키는 쪽을 왼쪽에 크게, 받는 쪽을 오른쪽에 작게 놓는 나무 배치이고, 덩어리·메모·칸반은 한 덩어리로 다루며, 한 번 되돌린다. 저절로 옮기는 것은 새 노드를 놓을 때뿐이다. 자리가 바뀌면 판 이벤트 `node_moved { from, to, cause }`를 남긴다.
- **H8 `@all`.** 캔버스 전체의 에이전트 세션(셸 빼고)이다. `session.send`에 `workspace`를 주면 그 워크스페이스만 받는다(CLI `--ws`).

### I. 그 밖의 기능

- **I1 출력 보기.** 끝난 답이 길면(앞뒤 공백을 뺀 80자 초과나 문단 3개 초과, 요약 `output.long`) 노드 머리줄에 "출력 보기"가 나온다. 대화 기록에서 턴(사람이 쓴 지시 하나로 시작)의 마지막 답을, hook 없는 세션은 화면 답을 캔버스 오른쪽의 떠 있는 창에 마크다운으로 보인다. 거기서 답장하고(`session.send { source: 'output' }`) 판 데이터 폴더의 `outputs/<워크스페이스 이름>/`에 `.md`로 저장한다. 사용자 저장소 안에는 쓰지 않는다.
- **I2 Thread.** 명령 바와 루프가 보낸 모든 글과 대상별 전달 상태, 완료 보고(마지막 답 4,000자까지), 버려진 전달을 시간순으로 최근 500개 남긴다. 연결 알림, 새 세션 첫 지시, 묶음 실행 지시는 남지 않는다. 명령 바 위에 펼친다.
- **I3·I4 메모와 칸반.** 캔버스의 마크다운 글 노드와, 열과 카드를 가진 칸반 노드(열 하나면 체크리스트). 놓은 노드가 영역 안이나 바로 옆에 있으면 그 워크스페이스 소속이다. 카드를 세션에 이으면 세션 상태가 보이고 누르면 그 세션으로 간다. 글이 있는 메모, 카드가 있는 칸반·열은 지울 때 묻는다. 마크다운은 의존성 없이 직접 그린다.
- **I5 루프.** 같은 지시를 조건에 따라 다시 보낸다. 시작 조건은 주기(1분~24시간), 쉴 때(ready가 될 때), 마지막 답이나 화면의 특정 글이고, 멈춤 조건은 횟수, 시간, 마지막 답의 특정 글, 사람이다. 내 차례인 세션은 그 차례를 건너뛰고(`needs_you`, `busy`, `not_ready`) B1을 따른다. 셸에는 걸 수 없다. 토큰을 쓰므로 만들 때 `confirm`을 받는다. 백엔드가 꺼지면 멈추고 다시 뜨면 남은 횟수와 시간으로 이어 간다.
- **I6 미션 맵.** `M`으로 여는 덮개 화면. 두 열(명령 바와 지시하는 세션 → 세션)과 역할, 시킴, 띄움, 명령 바 전달, 루프 선. `mission.graph`가 부를 때마다 판 데이터로 만든다.
- **I7 설정과 트레이 상주.** 설정(`settings`)은 트레이 상주, 가지 펼치기 상한(K3), 보관(J), 새 세션 기본값(Claude Code 모델·노력 수준·권한 모드·herdr 자동 승인, Codex 실행 인자, DeepSeek 모델·직접 명령), 잠재우기 시간이다. 트레이 아이콘(Atrium 로고, 내 차례면 주황 점)은 앱이 도는 동안 늘 있고, Electron main(`app/src/main/tray.mjs`)이 백엔드에 따로 붙는다. 트레이 상주(기본 켜짐)면 창을 닫아도 앱이 남아 창과 같은 규칙으로 OS 알림을 띄운다. 트레이 메뉴는 열기, 내 차례 수, 백엔드 상태와 켜기·다시 띄우기·끄기(창을 먼저 닫는다), herdr까지 모두 끄기(확인), 앱 끝내기(백엔드와 세션은 계속), 백엔드도 끄고 끝내기다.
- **I8 셸과 판에 올린 패널의 복구.** herdr를 다시 띄운 뒤 패널이 남으면 같은 노드로 남고(에이전트가 없으면 셸), 패널이 없어지면 J1 규칙을 따른다. 셸에서 돌던 명령은 "끊긴 명령"으로 남긴다. 셸 화면은 줄바꿈을 푼 최근 줄(`recent_unwrapped`)로 읽는다.

### J. 세션 되찾기와 사이드바

- **J1 다시 켜도 그대로.** 백엔드가 도는 동안 herdr 연결이 끊긴 적이 있거나 꺼진 동안 herdr 서버 PID가 바뀌었을 때만 되살린다. 판이 띄운 claude는 `resume_argv`로 이어 가고, 판에 올린 claude는 herdr가 이어 가지 않으면 herdr가 아는 대화 ID로 이어 가며, 셸은 패널을 잃으면 같은 폴더의 새 셸로, 다른 종류는 herdr가 이어 가지 않으면 닫힘으로 남긴다. 모두 같은 노드, 자리, 덩어리, 연결이다. herdr가 그대로인데 패널이 없어지면 사람이 판 밖에서 닫은 것으로 본다.
- **J2 닫힌 세션.** 판에서 끈 세션과 사라진 세션은 캔버스에서 빠지고 닫힌 까닭(`killed`, `pane gone`, `not resumed after herdr restart` 등)과 함께 "닫힘"으로 남는다. "판으로 열기"는 claude를 같은 세션 ID로 이어 가고(새 설정 파일과 토큰), 셸은 같은 폴더에 새로 띄운다. 같은 이름(쓰이면 `-2`)과 마지막 자리로 놓고, 연결·덩어리는 되살리지 않는다. 판에 올린 claude를 다시 열면 그 대화 ID를 세션 ID로 하는 새 행을 만든다. 목록에서 빼기도 있다(대화 기록 파일은 그대로).
- **J3 판 밖 대화.** 열린 워크스페이스마다 `~/.claude/projects/<폴더 이름>/<세션 ID>.jsonl`에서 지난 대화를 찾는다. 리포에 속하는지는 대화 기록 안의 `cwd`를 G1 키 규칙으로 맞추고, 폴더 이름은 쓰지 않는다. 파일마다 머리와 꼬리만 읽고 경로·크기·수정 시각으로 캐시하며(표 `convo_index`), 15초마다 바뀐 파일만 다시 읽는다. 지시가 없는 대화와 판이 아는 대화는 판 밖 목록에 넣지 않는다. 대화 기록은 읽기만 하고, missed 지우기(J6)만 휴지통으로 보낸다.
- **J4 묶여 있지 않은 대화만.** 묶임 판정 순서: (1) Claude Code 세션 파일(`~/.claude/sessions/<pid>.json`)의 살아 있는 pid, (2) `claude` 명령줄의 대화 ID, (3) 데스크톱 앱 세션 목록(보관한 것도 묶임), (4) 대화 기록 안의 출처, (5) 출처가 없거나 `cli`가 아니면 "묶여 있을 수 있음", (6) 30초 안에 쓰였으면 "묶여 있을 수 있음", (7) 나머지는 묶여 있지 않음. 열기 직전에 한 번 더 판정한다. 묶여 있지 않은 대화만 같은 대화 ID로 판 세션이 된다(`--resume`). 갈라 열기(`--fork-session`)는 하지 않는다. 세션 파일과 데스크톱 목록은 공개된 형식이 아니라 바뀔 수 있다.
- **J5 사이드바.** 왼쪽, 평소에 닫힘(위 왼쪽 ☰, 오른쪽 레일, `Ctrl+Shift+E`). 열린 워크스페이스마다 접히는 묶음 아래 판 세션(상태, 내 차례 질문), 닫힌 세션, 판 밖 대화가 마지막 활동 순이다. 판 세션을 누르면 그 노드로, 리포 이름을 누르면 그 영역으로 가고, 닫힌 세션과 묶여 있지 않은 대화는 "판으로 열기"다. 다른 곳에 묶인 대화는 흐리게 묶인 곳만 보인다. 캔버스에 대화 노드가 있는 줄은 제목을 누르면 그 노드로 간다. 맨 아래에 보관함과 missed 함이 있다. 위에 거르기 칸이 있고, 열림과 접힘 상태는 창 프로필에 둔다.
- **J6 대화 노드와 missed.** 켤 때와 색인이 바뀔 때 폴더가 남은 터미널(cli) 대화의 리포 영역을 열고, 대화마다 읽기 전용 대화 노드(제목, 마지막 요청과 답, 도는 중, 판으로 열기, 보관)를 판 세션 아래 최근 순으로 놓는다(영역마다 40개, 자리는 표 `convo_nodes`). 같은 리포의 워크트리 대화는 워크트리 배경으로 묶는다. 한 대화의 셸 명령이 띄운 claude(`claude -w`, `herdr agent start`, `atrium child`·`spawn`)를 −5~+120초 안에 시작한 대화와 워크트리·폴더·첫 지시로 맞춰 띄움 선을 긋고, 하위 에이전트는 수로 보인다. 폴더가 없거나 시험 폴더(판 코드 저장소의 `backend/.dev`·`experiments`, 임시 폴더, `mtask-` 폴더)의 CLI·SDK 대화는 missed로 캔버스와 기본 목록에서 빼고, missed 함에서 휴지통으로 지운다. 지우기 직전에 다시 판정해 도는·묶인·데스크톱·판 세션 대화와 뿌리 밖·UUID가 아닌 파일은 거부한다.

### K. 가지 펼치기

- **K1 하위 세션 명령.** 판이 띄운 세션은 판 플러그인의 `bin/atrium`(`atrium child`, `atrium children`, `atrium child-kill`, 별칭 `mtask`)으로 하위 세션을 만들고 보고 끈다. Claude Code가 플러그인 `bin/`을 Bash 도구 PATH에 올리므로 사용자의 PATH를 고치지 않는다. 명령은 세션 설정 파일 env의 세션 ID, 세션 토큰(판 API 토큰과 세션 ID의 HMAC), 판을 찾아갈 값으로 `POST /branch/child|children|kill`만 부르고 판 API 토큰은 쓰지 않는다. 하위 세션은 판이 띄운 정식 세션(B3)이고 부모의 폴더, 모델, 노력 수준, 권한 모드를 물려받는다. 부모와 역할 선(기본 "워커")으로 잇고, 하위 세션의 herdr 이름, 패널, 역할, 일 시키기·답 읽기 명령은 명령의 응답으로 부모에게 간다(응답이 닿지 않았을 때만 F2처럼 알린다). `atrium child`는 하위 세션이 준비될 때까지 기다린다. `--cwd`가 다른 폴더면 그 워크스페이스에, `--worktree`면 `claude -w <이름>`으로 띄운다(신뢰하지 않은 저장소는 `needs_trust`로 미리 거부). `--kind`는 F5처럼 다룬다.
- **K2 나무와 스킬.** 하위 세션도 같은 명령을 써서 지시 한 번에 여러 단계로 펼쳐진다. 일 맡기기 스킬(`atrium-herdr:delegate`)의 순서는 만들기 → `herdr agent prompt <이름> "…" --wait` → `herdr agent read` → 모아 보고다. 끝난 하위 세션은 기본으로 두고, 사람이 끄라고 하면 자기가 만든 것만 끈다. 세션 설정 파일의 승인 규칙은 이 명령과 `herdr agent prompt|wait|read`만 묻지 않게 한다. herdr 명령은 대상을 가리지 않으므로 같은 판의 어느 에이전트에게나 간다. 같은 사용자 계정이라 격리는 아니다.
- **K3 불어나지 않게.** 세션 하나의 하위 세션 수, 깊이(사람이 띄운 세션이 1단계), 판 전체 하위 세션 수에 상한이 있다(설정 `branchMaxChildren`, `branchMaxDepth`, `branchMaxTotal`, ⚙에서 바꿈). 넘으면 만들지 않고 까닭(`too_many_children`, `too_deep`, `board_full`)을 명령의 응답, 판 이벤트, 창 알림으로 남긴다. 에이전트는 자기 자손만 끌 수 있고(아니면 `not_parent`) 끄면 자손까지 깊은 것부터 끈다. 하위 세션은 새 세션 ID로 띄운다.
- **K4 나무 모양.** 하위 세션은 작게 부모 오른쪽 열의 빈자리에 놓이고 형제는 위아래로 쌓인다(H7의 나무 배치를 새 노드 하나에). 다른 워크스페이스의 하위 세션은 그 영역에 놓인다. 노드 머리줄에 부모와 역할("@lead의 워커"), 사이드바와 미션 맵에서는 부모 아래에 들여 보인다. 다시 켜도 관계와 역할 선이 남는다.

## 5. 백엔드 모듈

| 모듈 | 하는 일 |
|---|---|
| herdr 어댑터 | 서버 띄우기(깨끗한 환경), 버전 확인, 요청(요청마다 연결), 이벤트 구독, 오류 변환. herdr 호출은 이 모듈(`backend/src/herdr/adapter.mjs`) 안에만 둔다. 구독할 패널 목록을 바꿀 때는 옛 구독을 1.5초 더 열어 두고 겹친 이벤트를 한 번만 내며, 바꾸기는 하나씩 한다. 그러지 않으면 세션을 잇달아 띄울 때 `agent_detected`를 잃는다 |
| 실행 계획 | 세션 설정 파일(http hook, 토큰과 env를 값으로, 승인 규칙), `--session-id`, `--settings`, `--no-chrome`, 모델과 권한 모드, `resume_argv` 등록, 신뢰 예상(`backend/src/launch.mjs`). 4절 B3 |
| hook 수신기 | `POST /hooks/claude`, 먼저 200 응답 뒤 이벤트로 변환. 토큰은 세션마다 따로 두고, `X-MT-Session` 헤더나 본문 `session_id`로 세션을 찾아 그 세션의 토큰과 비교한다. 본문 상한은 8MB(100KB 글의 `UserPromptSubmit`이 92KB였다, E3) |
| 상태 계산기 | 3절의 상태와 표시. herdr 상태와 hook을 합친다(`state.mjs`) |
| 화면 중계 | 가까이 보이는 노드마다 `herdr --session <판> terminal session control <pane> --takeover --cols --rows` 자식 프로세스를 띄워 프레임을 창으로 넘기고, 입력과 크기 조정을 넘긴다. 멀어지면 놓는다(`relay.mjs`) |
| 화면 요약 | `pane.read`로 마지막 줄, 권한 요청 선택지, 신뢰 대화상자, 셸 프롬프트(`screen.mjs`) |
| 대화 기록 읽기 | hook이 알려준 `transcript_path`를 이어서 읽는다. 마지막 지시, 대화 보기용 메시지 목록(`transcript.mjs`) |
| 전달 대기열 | 4절 B1의 규칙, 제출 확인(`<pasted_content>` 벗기고 비교), 취소(`delivery.mjs`, `text.mjs`) |
| 답하기 | 4절 A1의 키 순서, 보내기 전 확인. 허용한 키만 보낸다(`answer.mjs`) |
| 저장소 | SQLite(Node 24 내장 `node:sqlite`, E8): 판 배치, 노드와 세션 ID 연결, 이벤트, 전달, 봤음 기록, 연결, 워크스페이스, 덩어리, 기능 표, 대화 색인, 하위 세션. WAL, `synchronous = NORMAL`, `busy_timeout = 2000`, STRICT 표. `node:sqlite` 호출과 SQL은 `store.mjs`와 그 일부인 `store-records.mjs`, `store-recall.mjs`, `store-branch.mjs` 안에만 둔다 |
| API 서버 | WebSocket. 명령, 조회, 이벤트 구독, 터미널 프레임 스트림(`api.mjs`) |
| 시험용 CLI `atrium` | API를 그대로 부르는 얇은 클라이언트(`bin/atrium.mjs`, `bin/atrium-features.mjs`, 별칭 `bin/mtask.mjs`). herdr를 직접 부르지 않는다 |
| git 조사 | 브랜치, 바뀐 파일 수, `git diff --stat`, 워크스페이스 키(`git.mjs`) |
| 자원 감시 | 우리 패널 프로세스와 제어기의 메모리, D3의 프로세스 쪽 신호(`resources.mjs`) |
| 복귀 요약 | 판 이벤트를 "세션 × 종류" 한 줄로 모음(`changes.mjs`) |
| 연결 | 4절 F. 에이전트끼리 오간 지시 알아채기, 연결과 역할 저장, 워크트리 알아내기. 순수 함수(명령 글 나누기와 herdr 호출 읽기, 화면에서 답 고르기, 빈자리, 같은 저장소 선, 알림 글)는 `links.mjs`(창도 같이 씀), 나머지는 `backend.mjs` |
| 패널 추적 | 4절 G2·F3. 판 전용 herdr 세션의 모든 패널을 노드로 두고 셸 상태를 본다(`backend.mjs`의 `adoptPane`, `promoteShell`, `demoteToShell`, `pollShells`, `screen.mjs`의 `shellPromptState`) |
| 워크스페이스 | 4절 G1. 워크스페이스 키, 목록과 세는 값, 옛 판 옮기기(`workspaces.mjs`(창도 같이 씀), `migrate.mjs`, `git.mjs`의 `workspaceOf`) |
| 배치(단일 캔버스) | 4절 H. 영역, 덩어리, 크기 단계, 정리 배치, P5 판 옮기기, 영역 겹침 풀기(뜰 때와 노드를 놓거나 키운 뒤 겹친 영역을 오른쪽·아래로 통째로 밂, `settleRegions`). 순수 함수는 `canvas.mjs`와 덩어리 분할 나무 `dock-tree.mjs`(창도 같이 씀), 판 API는 `canvas-ops.mjs`, 옮기기는 `migrate-canvas.mjs`(덩어리 옛 행은 `canvas-ops.mjs` `migrateDocks`) |
| 실제 판 실행 | 바로가기 → `app/scripts/real.cmd` → `real.mjs`(바뀐 소스가 있으면 빌드, Electron을 `--dev` 없이 떼어 띄움). 바로가기는 `make-shortcut.ps1`, `npm run real`도 같은 프로필 |
| 검색 | 4절 H2(`search.mjs`, `store.searchText`, `store.searchOutputs`) |
| 출력·Thread | 4절 I1·I2(`outputs.mjs`, `thread.mjs`) |
| 메모·칸반 | 4절 I3·I4(`memos.mjs`, `kanban.mjs`) |
| 루프 | 4절 I5(`loops.mjs`) |
| 미션 맵 | 4절 I6(`mission.mjs`, 창도 같이 쓸 수 있음) |
| 설정·붙이기 | 4절 I7. 설정(`settings.mjs`, 화면 언어 `language` 포함), I 기능을 백엔드에 붙이기(`features.mjs`). 트레이는 Electron main의 `app/src/main/tray.mjs` |
| 화면 언어 | 영어(기본)와 한국어. 번역 모듈 `app/src/renderer/lib/i18n.js`(열쇠로 찾기, 단수·복수, 언어 바뀜 알림, React 훅)와 사전 `locales/en.js`·`ko.js`(열쇠는 화면 자리 이름). 언어는 판 설정 `language`를 따르고, 창이 백엔드를 받기 전에는 영어다. Electron main(트레이 메뉴, 확인창, OS 알림)도 같은 모듈과 사전을 쓴다. 백엔드가 만들어 화면에 보이는 글(확인 문구, 자주 나오는 오류, 복귀 요약, 띄운 곳)은 `message`(한국어, mtask CLI가 찍음)와 함께 열쇠(`msg`, 오류는 `key`·`vars`, `backend/src/msg.mjs`)를 주고 창이 번역한다. 닫힌 까닭과 missed 거부 이유는 코드로 번역한다. 에이전트에게 보내는 글과 mtask 출력은 번역하지 않는다 |
| 대화 목록·되찾기 | 4절 J. 대화 기록 찾기와 캐시, 묶임 판정(`convos.mjs`), 되살리기, 닫힌 세션 다시 열기, 판 밖 대화 이어 가기, 보관(손으로, 기간이 지나면 저절로, 꺼내기. 보관된 대화는 다시 읽지 않음), 리포 스스로 찾기(기간 안의 터미널 출처 대화의 리포를 빈 워크스페이스로, 사람이 닫은 것은 기억)(`recall.mjs`, 판정은 `archive.mjs`, 표 `archive`는 `store-recall.mjs`). 창은 `Sidebar.jsx`(보관함) |
| 판 밖 대화 노드·missed | 4절 J6. 띄움 관계 찾기(`spawns.mjs`), 분류와 휴지통 지우기(`missed.mjs`), 영역 안 자리(`convo-canvas.mjs`, 창도 같이 씀), 판 API는 `recall.mjs`. 창은 `ConvoNode.jsx`, 사이드바 missed 함 |
| 노드 얼굴과 들어가기 | 7.2. 얼굴 고르기(`lib/faces.js`, 아이콘 얼굴 포함), 종류 아이콘 한곳(`lib/kinds.js`. Claude Code, DeepSeek, Codex, Grok, Pi는 `assets/kinds/`의 로고(보여줄 종류는 `shownKind`, flavor가 먼저), 그 밖은 직접 그린 기호), 덩어리 안 노드로 들어갈 때의 화면(`lib/nav.js`) |
| 화면 생김새 | 7.1. 색은 `tokens.css` 한곳(강조 `--accent` 초록, 내 차례 `--attn` 주황. JS는 `lib/tokens.js`가 변수를 읽는다. xterm 테마, 세션 머리 점), 앱에 넣은 OFL 글꼴(`fonts.css`, 빌드가 `dist/fonts/`로, 고지 `app/THIRD_PARTY_NOTICES.txt`), 선 아이콘 한곳(`lib/icons.jsx`), 캔버스 위에 떠 있는 크롬(위 알약 묶음 둘, 좌우 도구 레일, 칩 줄, 줌 알약, 루프 목록: `Chrome.jsx`), 콘솔 아래쪽 승인 줄(`ApprovalCard.jsx`, 터미널이 줄 높이만큼 비킨다) |
| 가지 펼치기 | 4절 K. 하위 세션 명령(부모 알아보기, 정식 하위 세션 띄우기, 물려받기, 상한, 자기 자손만 끄기), 일 맡기기 스킬, 나무 자리(`branch.mjs`, `bin/atrium-child.mjs`(별칭 `bin/mtask-child.mjs`), 창 `Branch.jsx`, `lib/branch.js`) |
| 잠재우기 | 4절 D4. 리포 단위 판정과 잠재우기·깨우기(`sleep.mjs`, 판정 `repoSleepPlan`·`sessionActivity`, 초안 `draftAfterInput`, 설정 `sleepAfterMin`) |
| 이름 옮기기 | 옛 이름(multitask) 판을 처음 뜰 때 한 번 옮긴다(`rename-migrate.mjs`, 창 프로필은 `app/src/main/profile.mjs`, 세부는 `docs/log/p18-rename-atrium.md`). 환경 변수는 `config.mjs`의 `envVar`(ATRIUM_*, 옛 MTASK_*) |

직접 만들지 않는 것(herdr가 한다): 터미널(PTY) 띄우기와 유지, 세션 등록부, 서버 재시작 때 이어 가기, 막힌 패널에 입력 거부.

## 6. API

판의 API는 herdr를 드러내지 않는다. 요청은 WebSocket의 `{ id, method, params }`이고, 모두 `atrium call <메서드> <JSON>`으로도 부른다. 오른쪽 열은 쓰는 herdr 호출이나 출처다. 응답 모양과 오류의 세부는 코드 주석에 둔다.

- 되돌릴 수 없는 명령(`session.kill`, `herdr.stop`, `herdr.restart`, 지우기)은 `confirm` 없이 부르면 아무것도 하지 않고 확인 문구만 돌려준다(BRIEF 4절 "마지막 Enter는 사람이 누른다").
- `sessionId`와 `session` 자리에는 세션 ID와 이름을 둘 다 받는다. `workspace` 자리에는 키, 이름, 그 안의 폴더 경로를 받는다.

**세션과 전달**

| 판 API | herdr 호출이나 출처 |
|---|---|
| `session.spawn { cwd, name?, prompt?, model?, effort?, permissionMode?, kind?, args?, allowHerdr?, command? }` → `{ sessionId, name, workspaceKey, herdrWorkspaceId }` | `workspace.create` + `agent.start`, 첫 지시는 ready 뒤 `agent.prompt`. `kind: "shell"`이면 `workspace.create`만, `kind: "deepseek"`는 F6 |
| `session.send { target, text, workspace?, source? }` → `{ deliveries: [{ deliveryId, sessionId }], threadItemId }` | 대상마다 `agent.prompt`(B1). 셸은 `not_agent` |
| `delivery.cancel { deliveryId }` | 판 대기열 |
| `session.answer { sessionId, toolUseId?, since?, choice \| picks, text? }` → `{ sent, label, steps }` 또는 `{ sent: false, reason }` | `agent.get` 확인 뒤 `agent.send_keys`, `pane.send_text`(A1). hook 없는 세션은 `answer_in_terminal` |
| `session.kill { sessionId, confirm, after? }` | `/exit`(다른 종류는 `ctrl+c` 두 번), `pane.close` 또는 `workspace.close`. `after`는 `archive` 또는 `delete`(D2) |
| `session.markSeen`, `session.touch`, `session.briefing`, `session.clearInterrupted`, `board.markSeen { at }` | 판 기록, 대화 기록 |
| `link.create { from, to, role }`, `link.delete { link, confirm }` | 판 기록, 알림은 `agent.prompt` |
| `trust.predict { cwd }` | `~/.claude.json` 읽기 |
| `backend.status`(이름 옮기기 결과 `migration` 포함), `backend.shutdown` | 없음 |
| `herdr.status`, `herdr.start`, `herdr.stop { confirm }`, `herdr.restart { confirm }` | herdr CLI `server`, `server stop`, `ping` |

**캔버스와 워크스페이스**

| 판 API | 받는 것 → 주는 것 |
|---|---|
| `board.get { workspace? }` | 노드, 연결, `workspaces`(영역 자리 `x`, `y`), `current`, `docks`, `canvas`, `viewport`, `memos`, `kanbans` |
| `board.setNode { …, cause? }`, `board.setViewport { x, y, zoom, workspace? }` | 자리와 크기, 뷰포트. 자리가 바뀌면 `node_moved` |
| `board.setSize { session, size: large \| normal \| small }` | 크기 단계. 덩어리 안이면 줄 방향만 |
| `board.arrange { workspace, apply?, undo? }` | 정리 미리 보기(`plan`), 적용, 한 번 되돌리기 |
| `workspace.list`, `workspace.open { path, select? }`, `workspace.close { workspace, confirm }`, `workspace.select { workspace }`, `workspace.move { workspace, dx, dy }` | 워크스페이스 목록(`key`, `name`, `kind: repo \| folder`, `root`, `counts`), 열기, 빈 것만 닫기, 영역 옮기기(겹치면 `overlap`) |
| `dock.attach { session, to, side, at?: leaf \| dock }`, `dock.create { members, dir: row \| col }`, `dock.layout { members, preset }`, `dock.update { dock, tree?, sizes?, x?, y?, w?, h? }`, `dock.remove { dock } \| { session, x?, y? }`, `dock.list` | 덩어리 붙이기(대상 노드를 반으로, 덩어리 옆 새 칸), 한 줄로 만들기, 배치 틀(`main-left`, `main-right`, `grid`, `row3`, `col3`, `row`, `col`), 나무(비율)·바깥 크기·옮기기, 풀기와 떼기. 덩어리는 `tree`(분할 나무), `members`(잎 차례), `dir`(뿌리 방향) |
| `search.query { q, limit? }` | `{ results: [{ kind: session \| workspace \| memo \| kanban, sessionId?, workspaceKey, field, snippet, score }] }` |

**그 밖의 기능**

| 판 API | 받는 것 → 주는 것 |
|---|---|
| `output.get { session, turn? }`, `output.save { session, turn? }` | 턴 문서와 지난 턴 목록(`source: transcript \| screen \| hook`), 저장한 파일 |
| `thread.list { before?, limit? }` | `{ items, more, before }` |
| `memo.create { text?, x?, y?, w?, h?, color?, workspace?, near? }`, `memo.update`, `memo.delete { memo, confirm? }`, `memo.list { workspace?, q? }` | 메모. 글이 있으면 지울 때 `needsConfirm` |
| `kanban.create { title?, columns?, …, near? }`, `kanban.update { kanban, op? \| ops?, confirm? }`, `kanban.delete`, `kanban.list` | 칸반. `op`는 열·카드 더하기, 이름 바꾸기, 옮기기, 지우기, `linkCard` |
| `loop.create { session, prompt, trigger, stop?, confirm }`, `loop.pause`, `loop.resume`, `loop.delete`, `loop.list { session? }` | 루프. `confirm`이 없으면 `needsConfirm` |
| `mission.graph` | `{ nodes, edges }`(부를 때마다 만듦) |
| `settings.get`, `settings.set { key, value }` | `tray`, `branchMaxChildren`, `branchMaxDepth`, `branchMaxTotal`, `archiveDays`, `autoOpenRepos` |
| `recall.list { workspace? }`, `recall.closed`, `recall.reopen { session, model?, permissionMode?, effort? }`, `recall.dismiss { session }` | 보관되지 않은 닫힌 세션과 판 밖 대화, 보관된 수(`archived`), 다시 열기(묶여 있으면 `bound`), 보관(`dismiss`) |
| `convo.list { workspace?, refresh? }`, `convo.open { convo, … }`, `convo.binding { convo }`, `convo.scan`, `convo.discover` | 판 밖 대화, 판으로 열기, 묶임 다시 판정, 다시 훑기, 리포 스스로 찾기 |
| `archive.add { convo \| session \| items }`, `archive.restore { … }`, `archive.old { workspace, days?, confirm? }`, `archive.list { workspace? }` | 보관(열린 세션은 `open_session`), 꺼내기, 오래된 것 보관(`needsConfirm`), 보관함 |
| `convo.nodes`, `convo.move { convo, x, y }`, `convo.subagents { convo }`, `convo.classify`, `missed.list`, `missed.delete { all \| folder \| convos, confirm }` | 대화 노드와 자리, 하위 에이전트 목록, 분류 수, missed 목록과 휴지통 지우기(확인 없으면 `needsConfirm`). `board.get`에 `convoNodes`, `convoEdges` |
| `branch.tree`, `branch.limits` | 모든 열린 세션의 부모·깊이·역할과 상한 |
| HTTP `POST /branch/child { name?, prompt?, role?, cwd?, worktree?, model?, kind?, wait? }` | 머리글 `X-MT-Session`, `Authorization: Bearer <세션 토큰>`. → 하위 세션의 이름, 패널, 역할, 깊이, `next`(일 시키기·답 읽기 명령). 거부는 상한 까닭, `needs_trust` |
| HTTP `POST /branch/children { all? }`, `POST /branch/kill { name, only? }` | 자식 목록, 자손 끄기(`not_parent`) |

**조회**

| 판 API | 출처 |
|---|---|
| `session.list`, `session.get` | 판 저장소 + `agent.list`, `agent.get` + hook 상세 |
| `inbox.list` | 상태 계산기(모든 워크스페이스의 내 차례와 검토 대기) |
| `session.messages { sessionId, afterSeq }` | 대화 기록 |
| `session.events`, `delivery.list`, `changes.since { since }` | 판 이벤트 기록, 전달 기록 |
| `terminal.snapshot { sessionId }` | `pane.read { source: "visible", format: "ansi" }` |
| `resources.get`, `herdr.clients` | Win32_Process, herdr 서버 로그 |
| `link.list`, `link.log { link }` | 판 기록 |
| `agent.kinds` | `herdr agent` 도움말의 `kinds:` 줄 + `where.exe` |

세션 요약(`session.list`, `session.updated` 등의 `summary`)에는 상태와 상세 말고도 `workspaceKey`, `herdrWorkspaceId`, `elsewhere`, `shell { atPrompt, command, procs, since }`, `fromShell`, `interruptedTurn`, `output { long, chars }`, `loops`, `branch { depth, parentSessionId, parentName, child, role, worktree, children }`이 있다.

**구독과 스트림**

| 판 API | 출처 |
|---|---|
| `events.subscribe` | herdr `events.subscribe` + hook + 전달 상태. 이벤트: `session.created`, `session.updated`, `session.state`, `session.hook`, `session.answer`, `session.removed`, `board.changed`, `workspace.updated`, `link.updated`, `link.removed`, `link.event`, `herdr.clients`, `thread.item`, `memo.updated`, `memo.removed`, `kanban.updated`, `kanban.removed`, `loop.updated`, `loop.removed`, `settings.updated`, `recall.updated`, `branch.refused`, `backend.migration` |
| `terminal.attach { sessionId, cols, rows }`, `terminal.detach` | 제어기 프레임(`terminal.frame`, 첫 프레임 전체). `terminal.frame`과 `terminal.detached`의 `controllerPid`로 창이 옛 제어기의 늦은 이벤트를 가린다 |
| `terminal.input { sessionId, data }`, `terminal.resize { sessionId, cols, rows }` | 제어기 stdin. 붙여넣기 감싸기와 휠 변환은 창 쪽에서 한 뒤 보낸다(7.2) |

## 7. 화면 구조

주 화면은 무한 캔버스 하나다. 모든 워크스페이스의 세션이 한 캔버스에 있고 워크스페이스는 그 위의 영역이다(4절 H). 탭, 분할 창, 사이드바 목록을 주된 탐색 수단으로 쓰지 않는다(사이드바는 평소에 닫힌 보조 목록이다). herdr의 탭과 분할 레이아웃은 판에서 쓰지 않고, 판은 herdr 패널을 세션 단위로만 쓴다.

### 7.1 캔버스 위의 요소

| 요소 | 내용 |
|---|---|
| 세션 노드 | 세션 하나. 머리줄(이름, 상태, 기다린 시간, 부모와 역할, 워크트리)과 본문(7.2의 세 얼굴) |
| 승인 줄 | 세션이 waiting이면 그 노드 아래쪽에 붙는다. 묻는 것 한 줄, 허용(`1`), 거부(`Esc`), 터미널에서 답하기, 기다린 시간이 있고, 터미널은 줄 높이만큼 줄어든다. 모든 선택지, 지시 덧붙이기, 질문의 여러 개 고르기는 줄 위로 펼친다(질문과 계획은 처음부터 펼친다) |
| 연결선 | 판에서 정한 역할(파란 실선), 띄움(주황 실선), 알아챈 지시(주황 점선), 같은 저장소의 워크트리 관계(회색 점선). 선은 곡선이고 끝점이 있다. 받는 쪽이 작업 중이면 점선이 움직인다. 선 위 글은 역할, 마지막 지시 앞부분, 받는 쪽 상태이고, 누르면 오간 기록과 끊기가 뜬다. 노드 가장자리 손잡이(덩어리 안이면 가운데 점)를 끌어 다른 노드에 놓으면 역할을 묻는다 |
| 대화 노드 | 판 밖 터미널 대화의 읽기 전용 카드(4절 J6). 같은 리포의 워크트리 대화는 주황 점선 배경으로 묶이고, 띄운 대화와는 띄움 선으로 잇는다 |
| 워크스페이스 영역 | 한 워크스페이스의 세션 뒤에 깔리는 배경과 이름표(이름, 세는 값). 안의 것을 감싸도록 저절로 맞추고 이름표를 끌면 함께 움직인다. 살아 있는 워크트리는 옆의 위성 영역(`⎇ 브랜치`)과 브랜치 화살표로 보이고 리포 영역과 함께 움직인다(표 `worktree_areas`, `worktrees.mjs`, `worktree-areas.mjs`) |
| 붙여 묶기 덩어리 | 가로·세로를 섞어 나눈 노드들(분할 나무). 틈이 없고 마디마다의 분할선, 바깥 테두리, 엇갈리는 점, 오른쪽 아래 손잡이로 크기를 나눈다. `Ctrl`+끌기 중에는 놓일 자리를 주황 얇은 선과 옅은 채움으로 보인다 |
| 메모·칸반 노드 | 캔버스의 글 노드와 칸반(체크리스트) 노드 |
| 고정 요소 | 캔버스 위에 떠 있다. 위 왼쪽 알약(☰, 워크스페이스 탭과 세션 수, + 리포 열기, 찾기), 위 오른쪽 알약(내 차례 n, 검토 n, 문제 n은 누르면 펼침 목록, 연결, 메모리, 바뀐 것, ⚙), 왼쪽 도구 레일(선택과 손으로 잇기, Claude·DeepSeek·Codex·셸 새 세션: 누르면 지금 워크스페이스에 새 세션 기본값으로 띄우고 그 터미널로 들어가며 Shift+누르기는 대화상자, 메모, 칸반, 전체 보기), 오른쪽 레일(사이드바, 미션 맵, 루프, 보관함, 설정), 아래쪽 칩 줄(새 세션 대화상자, 정리, 미션 맵, 바뀐 것, 전체 보기)과 명령 바, 오른쪽 아래 줌 알약. 노드를 고르면 맨 위 줄 가운데에 크기(가로|세로 토글, 크게·보통·작게)·세션 수에 맞는 배치 틀·고름 풀기 막대가 뜬다. 판을 받기 전에는 처음 화면(텍스트 로고, 최소 2초)이 덮는다 |
| 출력 보기, Thread, 미션 맵 | 캔버스 오른쪽의 떠 있는 창, 명령 바 위에 펼치는 대화 기록, 캔버스를 덮는 지시 그래프 |
| 사이드바 | 왼쪽, 평소에 닫힘(4절 J5). 캔버스는 옆으로 줄어들 뿐 자리와 배율은 그대로다 |

### 7.2 세션 노드의 세 얼굴

노드가 화면에서 차지하는 너비에 따라 본문을 바꾼다(배율이 아니다). 360px 이상이면 가까이, 200px 이상이면 중간, 그보다 작으면 멀리다. 경계에는 이력 16px을 둔다. 제어기는 가까이 얼굴이면서 화면에 보이는 노드에만, 화면 가운데에 가까운 순서로 최대 8개 붙인다. 화면 밖으로 나간 노드는 1.5초 기다렸다가 놓는다. 상한을 넘는 노드는 터미널 대신 안내와 마지막 답을 보인다(E5).

1. **가까이:** 실제 터미널(xterm.js). 제어기 프레임을 그리고 입력할 수 있다. 노드 크기가 패널 크기가 된다. 프레임은 herdr가 자기 화면 모델을 다시 그린 것이라 괄호 붙여넣기와 마우스 추적 같은 터미널 모드가 xterm.js에 오지 않는다. 그래서 판이 아래를 직접 한다(E4).
   - `allowProposedApi: true`로 만들고 `@xterm/addon-unicode11`을 켠다. 켜지 않으면 이모지가 든 줄이 어긋난다.
   - 프레임의 `w`·`h`가 바뀌면 그 프레임을 쓰기 전에 xterm 크기를 맞춘다.
   - 붙여넣기는 가로채 `ESC[200~ … ESC[201~`로 감싸 보낸다. 감싸지 않으면 줄마다 따로 제출된다.
   - 마우스 휠은 SGR 마우스 시퀀스(위 `ESC[<64;x;yM`, 아래 `ESC[<65;x;yM`)로 바꿔 보낸다. 그러면 Claude Code가 스스로 대화를 스크롤한다.
   - Claude Code는 전체 화면 렌더러(기본값)로 띄우고 `CLAUDE_CODE_DISABLE_ALTERNATE_SCREEN`을 넘기지 않는다. 클래식으로 떨어지면 노드에 알린다.
   - WebGL 렌더러는 예산(기본 8) 안에서만 쓰고, 넘거나 컨텍스트를 잃으면 DOM으로 그린다. 노드마다 오류 경계를 둔다.
2. **중간:** 대화 보기. 대화 기록에서 사용자 지시, AI 답, 도구 사용을 채팅 형태로 보여준다.
3. **멀리:** 요약. 이름, 상태, 기다리는 질문, 마지막 요청, 마지막 답(4절 H3). 쉬는·잠든 노드는 흐리게 하지 않고 바탕·테두리 명도와 점선으로 구분한다.

### 7.3 Orca와 Ovis에서 가져온 것

- 대화 보기(채팅 화면): 7.2의 중간 얼굴
- 승인 줄에서 바로 답하기: `agent.send_keys`로 구현한다(E9).
- 테마(터미널, 채팅 화면, 문법 강조, 아이콘)는 아직 다루지 않았다.
- 가져오지 않는 것: 탭, 분할 창, 사이드바 목록을 주 탐색으로 쓰는 구조

### 7.4 캔버스를 위해 백엔드가 준비하는 것

| 기능 | 내용 |
|---|---|
| 판 배치 저장 | 노드 위치, 크기와 크기 단계, 겹침 순서, 워크스페이스 영역 자리, 덩어리, 뷰포트, 노드와 세션 ID의 연결 |
| 메시지 목록 | 대화 기록 JSONL을 사용자 지시, AI 답, 도구 사용 목록으로 바꿔 주는 조회(`session.messages`) |
| 요약 필드 | 상태, 대기 상세, 마지막 요청과 답, `pane.read`의 마지막 줄(6절 세션 요약) |
| 승인 줄 답하기 | `session.answer`(→ `agent.send_keys`). 키 순서는 4절 A1 |
| 가까이 노드만 화면 스트림 | 가까이 얼굴인 노드에만 제어기를 붙이고, 노드 크기를 패널 크기로 보낸다 |
