# Atrium 설계

0.4 통합 소스의 구조를 적는다. 목적과 경계는 `docs/BRIEF.md`, 결정 경위는 `docs/decisions.md`, 남은 검증은 `docs/PLAN.md`에 둔다. 코드가 참조하는 절·기능 번호를 유지한다. 기능 설명은 통합·native 실행 환경·패키징 검증이나 배포 완료를 뜻하지 않는다.

## 1. 프로세스 구조

```text
Electron 창 ───────────────┐
로컬 atrium CLI ───────────┼─ loopback HTTP / WebSocket ─ Node 백엔드
등록한 브라우저 ─ Tailscale┘                            ├─ SQLite·기록 색인
  (원격 명시적 활성화 시)                               ├─ 제공자 hook 수신
                                                       ├─ Codex app-server 프로토콜
                                                       └─ herdr 어댑터·터미널 제어기
                                                                    │
                                                      전용 herdr 서버 atrium
                                                       └─ 작업 공간 → 패널 → CLI/셸
```

herdr는 PTY와 프로세스 수명을 소유한다. 백엔드는 세션 상태·대기열·보드 기록·복구를 관리하며, Electron과 브라우저는 같은 보드를 그리는 클라이언트다. 화면이 닫혀도 백엔드와 herdr 작업은 유지될 수 있다. 하위 세션 명령은 보드 API 토큰 대신 세션별 자격 증명으로 `POST /branch/*`를 호출한다.

**엔진 탐색과 시작**

- 이름 있는 전용 herdr 세션만 쓴다. 기본 사용자 herdr 세션을 채택하거나 정리하지 않는다. 서버에는 부모 Claude 표시 변수를 제거한 환경을 준다.
- `herdr/discover.mjs`는 `ATRIUM_HERDR`, 저장된 경로, 번들, PATH·알려진 설치 위치를 검사한다. Windows 실행 파일과 macOS/POSIX 경로를 구분한다. 번들 기준은 herdr 0.9.5이고, `config.mjs`의 지원 프로토콜 및 필요한 capabilities로 호환성을 판단한다.
- herdr가 없거나 호환되지 않아도 보드는 저장된 데이터와 상태 안내를 제공한다. 터미널 작업은 `herdr_missing`, `herdr_incompatible`, `herdr_down` 등으로 거부한다. 설정에서 경로를 바꾸면 다시 탐색한다.
- API 요청은 백엔드 초기화의 ready Promise를 기다린다. 같은 프로필의 동시 백엔드 시작 요청은 하나의 시작 작업을 공유한다. 도는 중 herdr가 사라졌다고 임의로 계속 재시작하지 않는다.
- macOS 패키지는 설치된 번들 기준으로 Node·herdr를 찾고 수신자 Mac에서 CLI 경로를 탐색한다. 빌더의 개인 홈·PATH를 배포 설정에 넣지 않는다. 패키징·서명·라이선스 복사는 `app/scripts/package-macos.mjs`가 맡는다.

**프로필과 데이터**

| 항목 | 실제 보드 | 개발 보드 |
|---|---|---|
| herdr 세션 | `atrium` | `atrium-dev` 또는 별도 시험 이름 |
| 보드 데이터 | macOS Application Support의 `atrium`, Windows LOCALAPPDATA의 `atrium` | `backend/.dev/data` 또는 명시한 격리 폴더 |
| 창 프로필 | `atrium-app-real` | `atrium-app-dev` 또는 별도 프로필 |
| 제공자 기록 | 사용자가 명시적으로 고르거나 기존 기록 정책이 허용한 경로 | 별도 시험 기록 경로; Codex 가져오기는 격리 CODEX_HOME 검사 |

실제·개발 프로필 혼용 방지, 옛 multitask 기록 이행, 환경 변수의 세부는 `config.mjs`, `rename-migrate.mjs`, `docs/testing.md`를 따른다. 원격 활성화 여부와 관계없이 API 수신 주소는 loopback이다. Tailscale Serve는 별도로 허용된 요청을 그 주소로 프록시한다.

## 2. 통신 경계

- herdr 요청·이벤트 구독은 어댑터로, 화면·입력·resize는 터미널 제어기로 분리한다. 구독 교체 중 겹친 이벤트와 오래된 요청 응답은 현재 세대로 가린다.
- 패널 하나의 제어기를 여러 클라이언트가 공유한다. 최근 입력·초점의 클라이언트가 크기를 정하고, 구독마다 첫 전체 프레임을 받는다. `controllerPid`와 `attachmentId`로 이전 연결의 프레임·detach를 구분한다. 원격 프레임은 배치해 전달할 수 있다.
- hook 수신기는 세션 토큰을 검증하고 응답한 뒤 상태·기록 갱신을 처리한다. 제공자별 hook과 native 기록의 역할을 구분하며 사용자 전역 인증·developer 지시를 덮지 않는다.
- Codex app-server는 목록·읽기·모델 조회와 명시적 사본 생성에 사용한다. import에서 원본 `thread/resume`이나 턴 시작을 호출하지 않는다. Native 사본을 실제로 띄울 때는 저장된 UUID로 CLI `resume`을 사용한다.
- 대기열 전송, 승인 키, 종료, 복구는 현재 세션·패널·대화 식별자를 다시 확인한다. 신뢰/로그인 화면의 상태를 작업 완료로 추측하지 않는다.

## 3. 세션 상태 모델

상태는 herdr, 제공자별 hook, native 기록과 보드 수명 정보를 합쳐 계산한다. Claude의 HTTP hook, Gemini CLI의 제출·완료 hook, agy의 도구 hook과 답변 기록은 서로 다른 신호다. 관리 Codex는 협업 문맥·자격 증명·native 대화 ID를 보존하며, 지원되지 않는 hook 정보를 만들어내지 않는다.

| 상태 | 의미와 주요 신호 |
|---|---|
| `starting` | 실행·복구를 시작했으나 입력 준비가 확인되지 않음. 제공자별 로그인·초기 동의도 별도 완료 증거 없이는 준비로 보지 않음 |
| `trust_wait` | 신뢰 질문 대기. Claude 설정의 예상과 실제 화면/blocked 신호를 함께 사용 |
| `ready` | 현재 에이전트가 입력 대기. 제공자 통합의 준비 조건과 herdr idle/done을 확인 |
| `working` | 턴 실행 중. herdr working과 제공자 제출·실행 신호 |
| `waiting` | 권한·선택 등 사람의 답을 기다림. 오래된 질문에 답하지 않도록 전송 직전 다시 확인 |
| `error` | 턴 또는 제공자 작업 실패. 모델 오류는 원인과 부모 워커 알림으로 연결하며 동일 오류 객체만 중복 제거 |
| `exited` | 에이전트 종료. 정상 종료·신뢰 거절·실행 엔진 소실을 구분 |
| `sleeping` | 관리 절전 또는 가져온 미실행 사본. 패널 없이 보드 행·기록·정확한 대화 ID 유지 |
| `shell_idle`, `shell_running` | 에이전트가 없는 셸의 프롬프트/실행 상태 |

`unseen`은 사용자가 아직 보지 않은 완료 결과, `quiet`는 작업 중 활동이 한동안 없는 상태, `delivering`은 전달 대기다. 종료·재시작 직전의 작업은 끊긴 턴으로 남긴다. 뷰포트와 초점은 클라이언트별이고, 봤음 및 활동 기록은 관련 보드 상태와 연결한다.

Claude 신뢰 예상은 `~/.claude.json`을 읽기만 한다. 커밋이 있는 git 저장소는 루트 경계에서 상위 탐색을 멈추며, 읽기 실패는 신뢰 확인으로 취급하지 않는다. 워크트리 관문은 K1에 따른다.

## 4. 기능

### A. 알아차리기

- **A1 내 답이 필요하다.** `ResponseNotice`가 질문·신뢰·로그인·오류의 맥락과 실제 터미널로 가는 동작을 제공한다. PC 승인·답변 카드는 제거한다. OS 알림도 해당 터미널을 열며 활동 클라이언트·중복·현재 보이는 노드를 고려한다. 도구 자동 모드가 로그인·신뢰·질문에 답하지는 않는다.
- **A2 검토 대기.** 보지 않은 마지막 답과 턴 상태를 구분한다. 답은 hook·native 기록·허용된 화면 fallback 중 실제 출처를 표시한다.
- **A3 복귀 요약.** 마지막으로 보드를 본 뒤 바뀐 내용을 세션과 종류별로 모아 보여준다. 처음 시작을 재시작으로 세지 않는다.
- **A4 조용함.** 최근 상태·hook·출력 활동을 기준으로 보조 표시한다. 침묵만으로 완료를 판정하지 않는다.
- **A5 실패와 종료.** 모델·권한·인증·프로세스 종료의 원인을 구분하고, 알려진 대화 증거와 복구 가능성을 함께 둔다.

### B. 말 걸기와 시작하기

- **B1 `@이름`으로 말 걸기.** 세션별 직렬 대기열을 사용한다. ready/error이며 현재 관리 에이전트와 패널이 유효할 때만 제출한다. 승인·신뢰·시작·작업·절전·최근 사용자 입력 중에는 보류한다. UTF-8 글과 줄바꿈·괄호 붙여넣기를 보존하고 제공자별 신호로 제출을 확인한다. 전송 중 재시작이나 연결 세대 변경을 현재 턴으로 오인하지 않는다.
- **B2 여러 세션에.** `@이름` 여럿과 `@all`을 지원한다. 셸은 요청 전달 대상이 아니다. 서로 다른 작업을 나누는 것은 에이전트의 협업 명령으로 한다.
- **B3 새 세션 시작.** `spawnPlanOf`가 호출자·기존 기본값·override로 제공자, 모델, 실행 명령, argv와 env를 푼다. Backend는 이름을 예약하고 제공자·게이트웨이·관리 설정·패널을 준비한다. `auto-approval.mjs`는 부모 권한을 제공자에 맞게 변환하고 보드의 `agentAutoApprove`가 켜졌으면 실행·복구 옵션을 자동 모드로 바꾼다. 공개 기본값은 false이고 전역 CLI 설정은 고치지 않는다. 첫 요청은 B1로 전달한다.
- **B4 호출자와 모델.** `launchers.mjs`가 프리셋·즐겨찾기·이행·미리보기를 관리한다. Codex/Gemini/agy 모델은 `agent.models`의 현재 목록, Claude는 별칭, 게이트웨이는 모델 endpoint에서 가져온다. `models.mjs`는 정확한 ID·별칭·자연어 이름을 풀며 모호함과 미등록 이름을 명시한다. 기본 Gemini 프리셋은 agy 하나이고 `flavor`로 Gemini CLI를 가장하지 않는다. 기존 DeepSeek 즐겨찾기는 유지한다.

명령 프리셋은 원문을 터미널로, env는 `workspace.create.env`로 보낸다. env 앞머리나 eval wrapper를 만들지 않는다. 원문·환경은 복구용 비공개 `rt.launcherCommand`·`rt.launcherEnv`에 보존하고 공개 이벤트의 command는 가린다. 로컬 저장 데이터는 암호화 보관함이 아니다.

### C. 복구

- **C1 창을 껐다 켬.** 화면만 다시 붙이며 세션을 중복 생성하지 않는다. 각 클라이언트의 뷰포트와 현재 공유 제어기 프레임으로 복원한다.
- **C2 백엔드 재시작.** 같은 프로필·포트에서 snapshot·agent 목록과 저장 상태를 맞춘다. 놓친 기록은 해당 제공자의 기록에서 읽고 새 구독 이후의 상태를 오래된 snapshot으로 덮지 않는다.
- **C3 herdr 재시작과 재부팅.** 서버 PID·연결 이력과 패널 소유권을 확인해 복구가 필요한 세션만 다룬다. 제공자별 정확한 native ID와 관리 설정을 다시 연결한다. 진행 중이던 턴은 끊김으로 남긴다. 기록 증거가 있는 대화를 새 대화로 대체하지 않으며, 잠든 사본은 자동 복구에서 제외한다.

### D. 자원과 안전

- **D1 자원.** 소유 패널의 셸 PID와 하위 프로세스 메모리를 조회한다. Windows는 프로세스 표, macOS는 POSIX 조회를 사용한다. 연결 예산·WebGL 예산의 실제 값은 코드에서 관리한다.
- **D2 끄기.** 현재 소유한 패널·workspace만 정리한다. 형제 패널이 있거나 열거가 불확실하면 workspace 전체를 닫지 않는다. 프로세스 이름으로 일괄 종료하지 않는다. 보관·삭제와 확인 절차를 구분하며 지원되는 기록 파일 삭제는 휴지통으로 보낸다.
- **D3 herdr 화면이 붙음.** 별도의 herdr TUI가 같은 패널을 제어하는 경우를 감지해 알린다. 보드 클라이언트끼리는 공유 제어기 소유권으로 크기를 정한다.
- **D4 잠재우기.** 관리 Claude의 프로젝트·세션 규칙을 구분해 `sleep.scope`에 저장한다(P111). 프로젝트가 바빠도 개별 세션이 자격을 갖추면 잠재우고, 프로젝트 깨우기는 개별 절전 세션과 미사용 사본을 제외한다. 개별 절전 세션 선택은 그것만 깨운다. 작업·신뢰 관문·초안·전달·루프·백그라운드 작업을 보호한다. Codex 사본은 저장한 UUID만 깨우며 실패한 패널의 추적을 유지한다.

### E. 다시 들어가기

- **E2 브리핑.** 오래 떠났다가 돌아온 세션에 마지막 지시·답·상태·질문을 먼저 보여준다. 원본 데스크톱 세션의 실시간 입력을 연결하는 기능은 아니다. 명시적으로 가져온 사본은 보드 세션으로 다룬다.

### F. 세션끼리 연결

- **F1 일 시키기를 선으로.** 관리 CLI의 셸 도구 신호에서 herdr 요청과 결과를 읽어 연결과 오간 일로 저장한다. 변수·스크립트 속 호출은 임의로 풀지 않고, 다른 보드를 대상으로 한 호출은 구분한다. 도구 stdout·완료 본문이 없는 제공자의 결과를 만들지 않는다.
- **F2 판에서 잇기.** 방향 있는 세션 쌍에 연결 하나를 두고 역할·herdr 이름·패널·후속 명령을 알린다. 연결을 끊어도 기록은 남긴다. 패널이 바뀌면 현재 패널을 알린다.
- **F3 판에 올리기.** 전용 herdr 안의 미등록 패널·에이전트를 채택할 수 있다. 채택과 관리 세션은 구분하며, 채택만으로 사용자 CLI 설정·hook을 바꾸지 않는다.
- **F4 워크트리.** 생성은 Claude 등 제공자의 기능에 맡긴다. cwd·git 공통 폴더와 브랜치를 조사해 같은 저장소 내부의 상자로 묶는다. 외부 위성 영역과 화살표는 현재 표현이 아니다.
- **F5 제공자별 통합.** Claude는 HTTP hook과 관리 resume argv, Gemini CLI는 별도 프로필·제출/완료 hook·native 기록, agy는 명시적 hook 항목과 native 답변 기록을 사용한다. hook 비활성화 설정을 존중한다. 관리 Codex는 세션 범위 자격 증명·private branch 파일·협업 문맥과 정확한 native ID를 사용한다. 다른 CLI는 지원되는 herdr 상태·화면 정보를 사용한다.
- **F6 DeepSeek.** 기본 예시는 Claude Code와 별도 opencodex 게이트웨이 env의 조합이다. 실행 전에 게이트웨이를 확인하되 스스로 켜지 않는다. 직접 명령 프리셋도 가능하며, 이때 셸과 env의 실행 규칙은 B3을 따른다.

Claude 플러그인은 herdr와 `atrium` 스킬, 옛 `delegate` 별칭, `atrium`/`mtask` 명령 shim을 포함한다. Codex 문맥은 기존 사용자·개발자 지시를 대체하지 않는다. 보드 밖 기존 세션을 협업 대상으로 자동 연결하지 않는다.

### G. 워크스페이스와 일반 셸

- **G1 워크스페이스.** 저장소는 git 공통 폴더, 일반 폴더는 해당 경로로 식별한다. 워크트리는 본 저장소 키를 공유한다. 폴더가 git 저장소로 바뀌면 세션·메모·칸반·도킹·대화 노드·그룹 소속을 이행한다. 프로젝트 제거는 보드 데이터의 제거/보관 선택을 받으며 디스크의 폴더와 대화 파일을 지우는 명령과 구분한다.
- **G2 일반 셸.** 전용 herdr의 에이전트 없는 패널을 노드로 둔다. 에이전트 등장·종료 때 같은 노드를 전환한다. 새 셸은 workspace를 만들고 명령 프리셋이면 별도 env와 원문 명령을 사용한다. 셸의 명령은 실제 터미널에서 입력한다.
- **G4 가로지르기.** 내 차례·검토 대기·문제·검색·자원은 모든 프로젝트를 가로지른다. 프로젝트 가상 그룹은 정리·탐색용이며 예전 세션 전송 그룹과 다르다.

### H. 단일 캔버스와 관계 표현

- **H1 한 캔버스와 영역.** 프로젝트 영역이 세션·메모·칸반·도킹을 감싸고 워크트리 상자를 내부에 둔다. 새 항목은 빈자리에 놓고, 저장된 배치와 사용자 위치를 유지한다. 뷰포트는 클라이언트별로 저장한다.
- **H2 바로 가기와 이름.** 탭·가상화 사이드바·검색으로 이동한다. 표시 이름 `label`은 한글을 허용하고 에이전트 주소 `name`은 유지한다. `findSession`은 ID·주소·표시 이름을 풀며 요약은 표시 이름과 주소를 구분한다. 검색은 보드 색인을 대상으로 하고 Mac 수정키·IME 입력을 보호한다.
- **H3 오버뷰.** 먼 노드에도 이름·상태·질문·최근 요청/답을 보여준다. 작은 얼굴에서 끌기와 들어가기를 구분한다.
- **H4 바로 들어가기.** 화면 크롬을 고려해 대상 노드나 도킹을 화면에 맞춘다. 초점·선택·터미널 연결 시점을 구분하고 대화상자의 Esc·Tab·복귀 초점을 관리한다.
- **H5 붙여 묶기.** 도킹은 분할 나무·비율을 저장하며 herdr 레이아웃을 바꾸지 않는다. 같은 저장소의 여러 워크트리를 섞어 묶어도 각 노드의 원래 소속을 유지한다. 워커는 부모 오른쪽의 열로 배치하고 관계선은 본문을 덜 가리게 그린다.
- **H7 크기와 정리.** 도킹은 가상 단독 세션의 크기와 실제 바깥 크기를 구분하며 틀 비율을 지킨다. 정리는 프로젝트·상자·메모·칸반과 관계를 고려하고 사람이 정한 그룹 순서·제외를 보존한다. 새 안팎 폴더는 자동 그룹으로 묶는다. 프로젝트·보드 전체 정리와 되돌리기에서 주변 겹침을 처리한다.
- **H8 `@all`.** 보드 전체의 에이전트 대상이다. API에 workspace를 주면 그 프로젝트 범위로 좁힐 수 있다. 프로젝트 가상 그룹을 자동 수신 대상으로 해석하지 않는다.

### I. 그 밖의 기능

- **I1 출력 보기.** 긴 완료 답변을 실제 출처에서 읽어 Markdown으로 보여주고 다시 요청하거나 보드 데이터 폴더에 저장한다.
- **I2 Thread.** 보드 요청과 전달 상태·결과를 표시한다. 세션별 필터, 복사, 재전송, 수정 후 전송을 제공하며 새 전송은 기존 대기열을 따른다.
- **I3·I4 메모와 칸반.** 캔버스의 Markdown 노드와 카드/열을 프로젝트에 배치한다. 새 메모와 먼 메모의 편집 진입을 구분한다. 글이 있는 항목을 지울 때 확인한다.
- **I5 루프.** 주기·쉬는 상태·답의 글자 조건에 따라 요청하고 횟수·시간·글자·사람의 중지로 멈춘다. 승인·신뢰·작업 상태를 우회하지 않으며 토큰을 쓰는 반복 생성에는 확인 절차가 있다.
- **I6 미션 맵.** 역할·위임·요청·루프를 프로젝트와 부모/자식 트리로 보여준다. 접기·개수·선택을 보드 상태와 동기화한다.
- **I7 설정과 트레이 상주.** 언어, 트레이, worker 상한, 기록, 절전, herdr 경로와 원격 사용자 정책을 관리한다. 호출자는 별도 CRUD와 즐겨찾기를 사용한다. 화면 크기·터미널 글자 크기·하단 표시 등 클라이언트 표현 설정은 UI 경로를 따른다. 트레이는 앱·백엔드·엔진 수명을 구분해 제어하고 활동 클라이언트 알림 정책을 따른다.
- **I8 셸과 채택 패널의 복구.** 남은 패널은 보존하고, 잃은 패널은 출처·native ID·관리 여부에 맞는 경로로 복구한다. 명령 프리셋의 private 원문과 env는 공개 이벤트를 대신해 복구에 사용한다. 가림 문자열을 원문으로 실행하지 않는다.

- **I9 앱 업데이트.** `Qualop/atrium-macos`의 stable/dev 완성 앱 ZIP을 받아 체크섬·서명·번들·CPU·런타임을 검사한다. 별도 helper가 설치 Mac 앱을 교체·재실행하고 실패하면 이전 번들로 복구한다. 릴리스 소스 빌드나 npm 실행으로 체크아웃을 덮지 않는다.

### J. 세션 되찾기와 사이드바

- **J1 다시 켜도 그대로.** herdr 재시작 여부와 현재 세션·패널을 확인한다. 관리 Claude/Gemini/agy/Codex는 제공자별 정확한 ID로 재개하고, 미사용 세션의 fresh start는 과거 턴 증거가 없을 때만 허용한다. 관리하지 않는 세션의 복구 가능성을 추정하지 않는다. 실패 시 새로 만든 패널만 정리한다.
- **J2 닫힌 세션.** 다시 열기는 저장된 모델·인자·private env와 실제 대화 ID를 사용한다. 다른 곳에 묶인 원본은 거부한다. 셸은 같은 폴더에서 열고, 명령 원문이 없으면 가림 문자열을 실행하는 대신 오류를 낸다.
- **J3 판 밖 대화.** Claude CLI 기록의 cwd·출처·경로·크기·수정 시각으로 색인한다. 기록은 읽기만 하고 보드가 아는 대화와 중복하지 않는다. Codex는 native 프로토콜을 사용하며 Claude JSONL로 변환해 가장하지 않는다.
- **J4 묶여 있지 않은 대화만.** 기존 Claude 세션 파일·살아 있는 프로세스·desktop 목록·출처·최근 기록 쓰기를 확인한다. 기존 원본 이어 가기와 J7의 명시적 사본 생성을 구분한다. 알려진 활성 Codex 원본은 복사를 거부하고, 별도 app-server가 다른 모든 클라이언트의 비활성을 증명한다고 간주하지 않는다.
- **J5 사이드바.** 프로젝트·가상 그룹·판 세션·닫힘·지난 대화·보관·missed를 가상화 목록으로 보여준다. 거르기·폭 조절·키보드 이동·접힌 프로젝트의 내 차례 수를 지원한다. 선택은 캔버스의 노드·영역과 연결한다.
- **J6 대화 노드와 missed.** 유효한 Claude CLI 대화는 읽기 전용 카드로, 사라진 폴더·시험 기록은 missed로 분류한다. 기록 삭제 직전에 경로·출처·실행 상태를 재확인하며 원본 desktop·보드 세션을 일괄 삭제하지 않는다.
- **J7 데스크톱 사본.** `desktop.list`가 Claude/Codex 후보를 기본 선택 없이 제공하고 `desktop.import`가 고른 항목만 처리한다. Claude는 별도 snapshot과 설정, Codex는 native `thread/fork` 사본을 잠든 세션으로 등록한다. 보드 UUID·제공자·원본 ID·사본 ID·가져오기 이력을 저장한다. 가져오기만으로 턴을 시작하지 않는다. 파일/DB 등록 실패는 소유한 변경만 되돌리고, Codex fork 결과가 불확실하면 무조건 재시도하거나 원본을 정리하지 않는다. 개발 프로필은 격리된 history 위치를 요구한다.

### K. 가지 펼치기

- **K1 하위 세션 명령.** `atrium child|children|child-kill|child-wait|wake|models`와 옛 mtask 별칭이 `/branch/*`를 호출한다. 세션 ID·세션 토큰을 확인하며 Gemini/agy와 관리 Codex도 허용된 관리 출처여야 한다. `ATRIUM_BRANCH_FILE`은 세션 범위 private 자격 증명이고 보드 API 토큰을 읽는 우회로가 아니다. `--launcher`, 자연어 `--model`, `--effort`, `--kind`를 지원한다.
- **K2 나무와 스킬.** 생성된 `atrium` 스킬은 읽기 쉬운 worker 이름·위임 지시·결과 수집·사람이 답할 질문을 설명한다. 기본 제공자와 호환 모델만 상속하고 다른 제공자의 모델을 조용히 넘기지 않는다. 일 맡기기는 herdr 명령으로, 판 상태 기다리기는 child-wait로 한다. 같은 사용자 보드 안의 협업이며 별도 보안 격리는 아니다.
- **K3 불어나지 않게.** `branchMaxChildren`, `branchMaxDepth`, `branchMaxTotal` 상한을 유지한다. 비동기 준비 뒤 이름·용량을 동시에 예약하고 등록된 child를 중복 계산하지 않으며 실패하면 예약을 푼다. 제한 초과는 까닭을 반환한다. 자기 자손만 끄고 닫힌 중간 부모를 지나서도 깊은 자손부터 정리한다. 실제 기본값과 범위는 `settings.mjs`가 정의한다.
- **K4 나무 모양.** 새 child는 부모 오른쪽의 작은 노드로, 다른 프로젝트면 해당 영역에 둔다. 부모·역할·worktree·gate 정보를 저장해 요약·미션 트리·사이드바에서 공유한다.

`--worktree`는 커밋 있는 Claude 저장소에만 사용한다. 미신뢰 또는 확인 불가이면 `gate: trust`인 일반 세션으로 띄우고 지시 전달과 절전을 막는다. 사람의 신뢰가 설정에 반영되고 같은 패널의 에이전트 종료·셸 준비가 확인된 뒤 재실행한다. trust timeout, 닫힌/교체된 패널, 미준비 셸에서는 gate를 통과시키지 않는다.

### L. 여러 클라이언트와 원격

- **L1 공유 상태.** 각 연결은 클라이언트 ID·종류·활동을 알린다. 뷰포트는 별도로 저장하고 노드 이동·선택 관련 최신 보드 상태를 전달한다. 터미널은 공유 구독과 크기 소유권, 알림은 활동 클라이언트 선택을 사용한다.
- **L2 웹과 기기.** 원격은 기본 꺼짐이고 호스트가 켠 뒤 코드·승인으로 기기를 등록한다. 쿠키는 HttpOnly·SameSite=Strict와 HTTPS의 Secure를 쓰며 서버에는 세션 해시를 둔다. `remotePasskey` 기본값도 false이며 켜면 출처·RP ID에 묶인 WebAuthn 등록·로그인과 세션 만료를 적용한다. 회수는 세션·연결을 끊는다. 보드·child 자격 증명과 분리한다.
- **L3 Tailscale.** 진단·Host/Origin·동일 로그인/허용 목록 정책과 Serve 구성을 구분한다. CLI 변경은 명시적 확인이 있을 때만 실행하며 Funnel을 사용하지 않는다. 호스트의 loopback API를 광역 주소에 직접 bind하지 않는다. 등록 기기는 호스트 보드의 터미널 조작 권한을 가지며 읽기 전용 사용자가 아니다.
- **L4 휴대폰·푸시.** 휴대폰 보드·미션·터미널, 터치 입력·탐색·업로드와 설치형 웹 화면을 둔다. Web Push는 기기별 허용·구독·알림 설정을 사용하고 브라우저 푸시 서비스를 거친다. 원격 차단은 새 pairing·기기 연결·푸시 구독을 중지한다. 재접속과 서비스 워커 갱신은 입력·연결 세대를 지킨다.

## 5. 백엔드 모듈

| 모듈 | 책임 |
|---|---|
| `herdr/adapter.mjs`, `herdr/discover.mjs` | 실행 파일 탐색·호환 판정·서버 수명·소켓 요청·이벤트 구독·workspace env 전달 |
| `backend.mjs`, `features.mjs`, `config.mjs`, `client.mjs` | 초기화 ready gate, 관리 세션 등록·상태·API 연결, 프로필, 동시 백엔드 시작 재사용 |
| `launchers.mjs`, `spawn-plan.mjs`, `auto-approval.mjs` | 프리셋·즐겨찾기·실행 계획, 부모 권한 변환·보드 도구 자동 옵션, 원문/env 분리 |
| `models.mjs`, `codex-models.mjs`, `gemini-models.mjs`, `agy.mjs` | 자연어 모델 해석, 실제 제공자 catalog, gateway 목록, 제공자별 검증 |
| `launch.mjs`, `gemini.mjs`, `codex-session.mjs` | private 관리 설정, Claude 인자·신뢰 예상, Gemini profile, Codex 문맥·자격 증명·native resume |
| `branch.mjs`, `bin/atrium-child.mjs` | child 인증·제공자 상속·상한 예약·자손 정리·신뢰 관문·catalog·생성 스킬 |
| `state.mjs`, `screen.mjs`, `transcript.mjs` | 상태와 표시, 필요한 화면 읽기, 제공자별 대화·답 추출 |
| `delivery.mjs`, `answer.mjs`, `text.mjs` | 세션별 전달 직렬화·제출 확인, 현재 질문 답하기, 글 정규화 |
| `relay.mjs`, `herdr/adapter.mjs`의 Controller, `frame-batch.mjs` | 소유 제어기, 공유 화면 스트림·입력·resize, 원격 프레임 배치 |
| `multiclient.mjs`, `peers.mjs` | 클라이언트별 viewport·터미널 크기 소유권·활동·알림 라우팅 |
| `web.mjs`, `web-auth.mjs`, `passkey.mjs`, `tailscale.mjs` | opt-in 웹·기기 정책, 쿠키 세션·WebAuthn·회수, 명시적 Serve 변경 |
| `store.mjs`, `store-*.mjs` | SQLite 세션·private runtime·이벤트·보드·관계·색인·import 이력·소속 이행 |
| `git.mjs`, `workspaces.mjs`, `workspace-merge*.mjs` | 저장소 키·경로·브랜치 조사, 폴더→저장소 소속 이행 |
| `canvas.mjs`, `canvas-ops.mjs`, `region-layout.mjs`, `dock-tree.mjs` | 충돌·영역·분할 나무·전체 정리·되돌리기 |
| `worktrees.mjs`, `worktree-areas.mjs`, `ws-groups.mjs`, `ws-nest.mjs`, `ws-close.mjs` | 내부 worktree 상자·혼합 도킹, 폴더 자동 그룹·제거 계획 |
| `links.mjs`, `mission.mjs`, `spawns.mjs` | 역할·위임 기록, 미션 그래프, 기록 속 생성 관계 |
| `recall.mjs`, `convos.mjs`, `archive.mjs`, `missed.mjs`, `convo-canvas.mjs` | 기존 Claude history 색인·묶임·복구, 보관·missed, 대화 카드 배치 |
| `desktop-import.mjs`, `codex-import.mjs`, `codex-protocol.mjs`, `store-imports.mjs` | 명시적 선택 사본, Claude snapshot, Codex native 프로토콜과 import 이력 |
| `sleep.mjs`, `resources.mjs` | Claude 프로젝트·세션 절전 범위, 선택 Codex 사본 깨우기, 소유 프로세스 자원 |
| `search.mjs`, `outputs.mjs`, `thread.mjs`, `memos.mjs`, `kanban.mjs`, `loops.mjs`, `changes.mjs` | 검색·출력·요청 기록·메모·카드·반복·복귀 요약 |
| `settings.mjs`, `msg.mjs`, `api.mjs` | 설정 정의·기존 기본값 유지, 표시 메시지 열쇠, 인증된 요청·이벤트·ready gate |
| `session-label.mjs`, `web-push.mjs`, `push-cycle.mjs` | 표시 이름·안정된 주소, 기기별 알림 구독·전달 |
| `update.mjs`, `updater.mjs`, `update-swap.mjs`, `update-verify.mjs`, `update-native.mjs` | 소유자 저장소의 Mac 번들 조회·검증·교체·백업 복구 |
| `rename-migrate.mjs`, `migrate*.mjs` | 기존 보드 이름·schema·좌표 이행 |
| `bin/atrium.mjs`, `bin/atrium-features.mjs` | 로컬 API의 CLI. 옛 mtask 별칭 유지 |
| `app/src/main/cli-paths.mjs`, `app/scripts/package-macos.mjs` | 수신자 Mac의 CLI 탐색, 상대 번들 경로·서명·라이선스 패키징 |

직접 구현하지 않는 것: PTY와 에이전트 자체의 추론·인증·워크트리 규칙. 사용자 전역 Claude 설정을 관리 세션 설정으로 덮지 않는다.

## 6. API

WebSocket 요청은 `{id,method,params}`다. 로컬 CLI는 `atrium call <메서드> <JSON>`으로 호출한다. 기존 확인이 필요한 종료·삭제·루프 명령은 확인 없는 요청에 계획을 반환한다. Web 기기 권한은 L절, child 자격 증명은 K절을 따른다. 상세 오류와 schema의 최종 정의는 코드에 있다.

**세션과 제공자**

| API | 받는 것 → 주는 것 |
|---|---|
| `session.spawn {cwd,name?,launcher?,kind?,model?,effort?,args?,permissionMode?,allowHerdr?,prompt?}` | 관리 세션·workspace·신뢰 상태. 호출자 값과 명시적 override를 결합 |
| `agent.kinds`, `agent.models {kind}` | 제공자 종류·설치 상태, 제공자별 실제 모델 목록과 조회 상태 |
| `launcher.list`, `launcher.create`, `launcher.update`, `launcher.delete`, `launcher.favorite`, `launcher.order`, `launcher.preview` | 호출자·즐겨찾기·지원 필드·명령 미리보기 |
| `session.send {target,text,workspace?,source?}`, `delivery.cancel {deliveryId}` | 대상별 전달·Thread 항목, 전달 취소 |
| `session.answer {sessionId,toolUseId?,since?,choice?,picks?,text?}` | 현재 질문에 허용된 입력 또는 stale/터미널 안내 |
| `session.rename {session,name?,clear?,by?}` | 표시 이름 변경·비움 → name·address·label |
| `session.kill {session,confirm,after?}`, `session.wake {session,wait?,why?}` | 세션 종료/보관/삭제, 제공자별 깨우기 |
| `session.list`, `session.get`, `session.messages`, `session.events` | 공개 요약·메시지·이벤트. private runtime 원문·env는 공개 요약에서 제외 |
| `session.markSeen`, `session.touch`, `session.briefing`, `session.clearInterrupted`, `board.markSeen` | 봤음·활동·복귀·끊긴 턴 |
| `link.create {from,to,role}`, `link.delete {link,confirm}`, `link.list`, `link.log` | 역할 연결과 실제 오간 기록 |
| `trust.predict {cwd}`, `backend.status`, `backend.shutdown` | 신뢰 예상·보드 수명 상태 |
| `herdr.status`, `herdr.start`, `herdr.stop {confirm}`, `herdr.restart {confirm}` | 탐색/호환 정보·전용 엔진 수명 |

**캔버스와 프로젝트**

| API | 받는 것 → 주는 것 |
|---|---|
| `board.get`, `board.setNode`, `board.setViewport`, `board.setSize` | 배치·현재 클라이언트 viewport·노드 크기 |
| `board.arrange {workspace?,all?,apply?,undo?}` | 프로젝트 또는 전체 정리 계획·적용·되돌리기 |
| `workspace.list`, `workspace.open {path,select?}`, `workspace.select`, `workspace.move`, `workspace.close {workspace,confirm,after?}` | 프로젝트 목록·소속·영역 이동·확인된 보드 제거/보관 |
| `group.list`, `group.create`, `group.rename`, `group.remove`, `group.order`, `group.move` | 프로젝트 가상 그룹·순서·소속 |
| `dock.attach`, `dock.create`, `dock.layout`, `dock.update`, `dock.remove`, `dock.list` | 보드 분할 나무·구성 노드·비율·배치 |
| `search.query {q,limit?}` | 세션·프로젝트·메모·칸반별 맞는 기록 |

**기능과 기록**

| API | 받는 것 → 주는 것 |
|---|---|
| `output.get`, `output.save`, `thread.list` | 실제 턴 답변·저장 파일·요청 기록 |
| `memo.create`, `memo.update`, `memo.delete`, `memo.list`, `kanban.create`, `kanban.update`, `kanban.delete`, `kanban.list` | 캔버스 글과 카드·열 |
| `loop.create`, `loop.pause`, `loop.resume`, `loop.delete`, `loop.list`, `mission.graph` | 반복 요청 상태, 역할/위임 그래프 |
| `settings.get`, `settings.set` | schema와 값. worker 상한·도구 자동 모드·프로젝트/세션 절전·원격 정책 |
| `recall.list`, `recall.closed`, `recall.reopen`, `recall.dismiss` | 닫힌 관리 세션·정확한 대화의 복구 |
| `convo.list`, `convo.open`, `convo.binding`, `convo.scan`, `convo.discover`, `archive.add`, `archive.restore`, `archive.old`, `archive.list` | 기존 Claude 밖 대화·묶임·보관 |
| `convo.nodes`, `convo.move`, `convo.subagents`, `convo.classify`, `missed.list`, `missed.delete` | 대화 카드·분류·확인된 파일 정리 |
| `desktop.list`, `desktop.import {selections:[{provider,appSessionId}]}` | 기본 선택 없는 후보, 선택한 Claude/Codex 사본 등록·건너뜀 사유 |
| `workspace.sleep`, `workspace.wake`, `workspace.sleepIdle`, `sleep.status` | 절전·깨우기·진단과 repo/session 범위. 개별 절전은 프로젝트 깨우기에서 제외 |
| `resources.get`, `herdr.clients`, `inbox.list`, `delivery.list`, `changes.since` | 자원·별도 제어기·내 차례·전달·복귀 변화 |

**Child HTTP**

| API | 받는 것 → 주는 것 |
|---|---|
| `branch.tree`, `branch.limits` | 부모·깊이·역할·현재 상한 |
| `POST /branch/child` | 이름·지시·역할·cwd·worktree·model·launcher·effort·kind → child, 해석된 모델, gate·상한·후속 명령 |
| `POST /branch/children`, `/branch/kill` | 자기 child/자손 목록, 소유한 자손 종료 |
| `POST /branch/wait`, `/branch/wake`, `/branch/models` | 관문/준비 기다리기, 보드 대상 깨우기, 실제 catalog와 실행 명령 |

`X-MT-Session`과 Bearer 세션 토큰을 확인한다. 생성 제한과 현재 관리 세션 여부는 HTTP와 CLI 모두 동일하다.

**클라이언트·웹·스트림**

| API | 받는 것 → 주는 것 |
|---|---|
| `client.hello`, `client.active`, `clients.list` | 연결 ID·활동·알림 대상 |
| `web.status`, `remote.status`, `remote.configure {enabled}` | opt-in 상태·진단, local-only 활성화 |
| `device.list`, `device.code`, `device.cancelCode`, `device.approve`, `device.deny`, `device.rename`, `device.revoke` | 기기와 pairing. 코드 발급·승인은 호스트 전용 |
| HTTP `/web/pair/code`, `/web/pair/request`, `/web/pair/poll` | 새 기기 등록. 원격 비활성 상태에서는 허용하지 않음 |
| HTTP `/web/passkey/*`, `/web/me`, `/web/logout` | 출처·챌린지 검증, 쿠키 세션 조회·종료 |
| `push.status`, `push.subscribe`, `push.unsubscribe`, `push.prefs`, `push.test` | 현재 기기의 푸시 구독·알림 설정·시험 |
| `update.status`, `update.check`, `update.apply`, `update.leaving` | 채널·검증·교체 준비, 설치 앱 종료 협조 |
| `fs.roots`, `fs.list`, HTTP 업로드 | 인증된 브라우저의 호스트 폴더 목록·허용된 파일 수신 |
| `events.subscribe` | 세션·보드·프로젝트·관계·기능·호출자·기기·import 변화 |
| `terminal.attach`, `terminal.detach`, `terminal.input`, `terminal.resize`, `terminal.snapshot` | 현재 제어기·attachment 식별자와 공유 프레임·입력·크기 소유권 |

공개 세션 요약은 상태·질문·프로젝트·부모/자식·worktree/gate·가져오기 출처 등을 포함한다. hook 토큰, launcher env, 원문 command 같은 복구용 값은 별도로 유지한다.

## 7. 화면 구조

### 7.1 캔버스 위의 요소

| 요소 | 현재 역할 |
|---|---|
| 세션 노드 | 제공자·이름·상태·부모·역할·브랜치와 터미널/대화/요약 얼굴 |
| 응답 필요 안내 | `SessionExtras.jsx`의 `ResponseNotice`: 질문·신뢰·로그인·오류를 보여 주고 실제 터미널로 이동 |
| 연결선 | 역할·위임·생성 관계. 도킹 내부는 본문을 덜 가리는 경로와 배율별 설명 |
| 프로젝트와 worktree | 프로젝트 내부 worktree 상자, 영역 이름·수·이동·정리 |
| 도킹 | 분할 나무의 비율과 바깥 크기를 조절하는 세션 묶음 |
| 메모·칸반·대화 카드 | 프로젝트의 글·작업 카드·읽기 전용 기존 기록 |
| 크롬과 명령 바 | 즐겨찾는 호출자, 내 차례·검토·검색, 표시 설정, 전체 보기·정리, 대상별 요청 |
| 사이드바 | 가상화 프로젝트/그룹/세션 트리, 거르기·키보드·폭·접기·내 차례 수 |
| 요청 기록·출력·미션 | 필터·복사·재전송, 실제 답변 보기, 프로젝트별 역할/위임 트리 |
| 가져오기·기기 | 선택한 Claude/Codex 사본, 명시적 원격 활성화·pairing·회수 |

`Launchers.jsx`, `DesktopImport.jsx`, `Peers.jsx`, `Pair.jsx`, `WebDevices.jsx`, `RemoteBar.jsx`, `FolderPicker.jsx`가 해당 흐름을 맡는다. `dialog.js`, `lib/keys.js`, `lib/scale.js`, `lib/bottom.js`는 공통 조작을 다루고, `web.js`·`touch.js`는 브라우저 환경을 연결한다.

### 7.2 세션 노드의 세 얼굴

1. **가까이:** xterm 터미널. 보이는 노드의 연결·WebGL 예산을 적용하고 크기 변경과 프레임을 맞춘다. 기록 선택·가장자리 스크롤·복사는 `term-selection.js`와 `lib/term-select.js`가 다룬다. 입력은 제공자/셸별 붙여넣기 방식, Mac Command 수정키, 한글 조합 상태를 구분한다. Windows 전용 바이트를 POSIX 셸에 그대로 보내지 않는다.
2. **중간:** 실제 제공자 기록의 요청·답·도구 정보를 대화로 보여준다. 없는 상세 정보는 출처를 보완해 표시한다.
3. **멀리:** 이름·상태·질문·최근 작업을 보이며 선택·끌기·확대 동작을 구분한다.

얼굴 전환 기준과 예산은 `lib/faces.js`·`TerminalView.jsx` 등의 코드가 정의한다. 화면과 터미널 글자 크기는 캔버스 줌과 별도로 조절한다. 오래된 attachment나 controller 프레임은 현재 선택과 입력을 바꾸지 않는다.

### 7.3 화면 참고와 고지

대화 보기·응답 필요 안내·캔버스 구성은 기존 설계를 발전시킨다. 외부 제품의 코드·이름·로고·그림을 무단 복제하지 않는다. 제공자 로고는 도구를 구분하는 표시이며 관련 라이선스·글꼴 고지는 `app/THIRD_PARTY_NOTICES.txt`와 번들의 라이선스 폴더에 유지한다.

### 7.4 화면을 위해 백엔드가 준비하는 것

| 정보 | 책임 |
|---|---|
| 배치와 viewport | 보드 객체·project/group/worktree 소속과 클라이언트별 화면 위치 |
| 메시지·요약 | 제공자 기록·상태·질문·최근 요청/답·출처 |
| 역할과 작업 | 실제 link/thread/loop/import 이력과 parent/child 관계 |
| 입력과 스트림 | 공유 제어기·크기 소유권·세대 식별자·현재 상태 사전 검사 |
| 재연결 | ready gate 이후 snapshot과 최신 이벤트 병합, 끊긴 클라이언트 정리 |
