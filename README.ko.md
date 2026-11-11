<p align="center">
  <img src="docs/images/banner.png" alt="Atrium" width="560">
</p>

<p align="center">
  <b>여러 AI 코딩 작업을 한 화면에서 관리하세요.</b><br>
  Claude Code, Codex, Gemini CLI, 터미널을 위한 macOS 작업 공간입니다.
</p>

<p align="center">
  <a href="README.md">English</a> · <b>한국어</b> · <a href="LICENSE">MIT</a>
</p>

Atrium은 AI 코딩 세션, 프로젝트, 메모와 위임한 일을 한 캔버스에 놓는 앱입니다. Claude Code, Codex, Gemini CLI, Antigravity와 셸은 herdr 터미널에서 실행되고, Atrium은 배치·연결·메시지 전달을 관리합니다.

**0.4.0**은 원본 P111까지의 기능을 macOS 분기에 반영합니다. 휴대폰 화면, 선택적 패스키·푸시, Mac 앱 업데이트와 배치·절전 개선을 포함합니다. 관리 에이전트의 도구 자동승인과 부모 권한 변환을 지원하며, 질문·로그인·신뢰는 응답 필요 안내와 알림에서 해당 터미널로 연결합니다.

![macOS의 Atrium: 한국어 화면과 Codex 모델 선택](docs/images/model-picker-macos.png)

*별도 프로젝트에서 촬영한 이전 macOS 화면입니다. 현재 모델 목록은 설치된 도구와 계정 설정에서 가져옵니다.*

## 다운로드와 빌드 상태

Apple Silicon용 0.4.0을 제공합니다. DMG를 열어 Atrium.app을 Applications에 넣으세요.

- [DMG 다운로드](https://github.com/Qualop/atrium-macos/releases/download/v0.4.0/Atrium-0.4.0-macos-arm64.dmg)
- [ZIP 다운로드](https://github.com/Qualop/atrium-macos/releases/download/v0.4.0/Atrium-0.4.0-macos-arm64.zip)
- [SHA-256 체크섬](https://github.com/Qualop/atrium-macos/releases/download/v0.4.0/SHA256SUMS.txt) · [릴리스 노트](https://github.com/Qualop/atrium-macos/releases/tag/v0.4.0)

macOS 패키지는 macOS 13 이상을 대상으로 하며 Node와 herdr를 포함합니다. 에이전트 CLI 설치·로그인은 별도입니다. 배포 패키지는 ad-hoc 서명을 사용하며 Apple 공증은 받지 않았습니다.

## macOS에서 시작하기

소스 실행에는 **Node.js 22.13+ (22.x), 24.x 또는 26.x**, **Git**, 사용할 에이전트 CLI가 필요합니다.

```sh
git clone https://github.com/Qualop/atrium-macos.git
cd atrium-macos/app
npm run setup:mac
npm run mac
```

`setup:mac`은 의존성을 설치하고 CPU에 맞는 herdr 0.9.5의 SHA-256을 확인해 저장소의 `.tools/`에 둡니다. herdr를 전역 설치하거나 셸 설정을 고치지 않습니다. 다음 실행부터는 `app/`에서 `npm run mac`을 사용합니다.

herdr가 없어도 보드를 열어 저장된 배치·메모·기록을 볼 수 있습니다. 터미널 동작은 실행 엔진이 필요하다고 안내합니다. 설정의 실행 파일 경로나 `ATRIUM_HERDR`로 지정할 수 있고, 명시한 경로·번들·PATH·알려진 설치 위치에서 찾습니다. 호환성은 프로토콜과 기능으로 판단하며 번들 기준은 herdr 0.9.5 / 프로토콜 22입니다.

## 첫 세션과 실행 프리셋

1. **+**로 프로젝트 폴더를 엽니다.
2. **새 세션…**을 누르거나 왼쪽 실행 아이콘을 Shift+클릭합니다.
3. `reviewer`처럼 세션 이름을 정합니다. 모델과 별개로 작업창을 구분하는 이름입니다.
4. 실행 프리셋·제공자와 모델을 고르고 시작합니다. 로그인·신뢰·질문은 터미널에서 직접 답합니다. 도구 승인은 보드 설정을 따릅니다.
5. 아래 입력창에서 요청합니다.

   ```text
   @reviewer 이 프로젝트의 구조를 설명해줘. 파일은 수정하지 마.
   ```

**호출자(실행 프리셋)**에는 이름, CLI 제공자, 모델, 지원 옵션, 추가 인자와 환경 변수를 저장합니다. 직접 실행할 셸 명령도 저장할 수 있습니다. 설정에서 만들기·편집·미리보기·즐겨찾기·순서 변경을 합니다. 따옴표로 묶은 인자는 하나로 유지합니다. 명령 프리셋의 환경 변수는 프로세스 환경으로 따로 전달하며, 비밀 값을 명령 앞에 붙여 터미널에 입력하지 않습니다.

새 보드의 즐겨찾기는 Claude Code·Codex·Gemini·Shell 네 개입니다. 기존 보드는 DeepSeek까지 다섯 개를 유지합니다. **기본 Gemini 호출자는 하나**이며 Antigravity(`agy`)를 실행합니다. Gemini 로고를 쓰되 실제 제공자 표시는 agy로 유지합니다. Gemini CLI도 별도 제공자로 선택할 수 있습니다. 기존 기본값과 사용자가 바꾼 즐겨찾기는 이행 과정에서 보존하고, 호출자를 지정하지 않은 API 실행은 기존 세션 기본값을 사용합니다.

모델은 **Codex의 `model/list`**, **Gemini CLI 설치 메타데이터**, **Antigravity의 `agy models`**에서 조회합니다. Claude 별칭과 설정된 게이트웨이 목록도 사용합니다. 모델 이름에 GPT가 있어도 게이트웨이 경유 모델이면 Claude Code로 실행될 수 있습니다. 목록 표시는 계정의 실제 사용 권한을 보장하지 않습니다. 세션 설정에서는 모델 ID 직접 입력도 지원합니다.

`Enter`는 전송, `Shift+Enter`는 줄바꿈입니다. macOS에서 `⌘K`는 입력창, `⌘F`는 검색입니다. `@all`은 **보드 전체의 에이전트 세션**을 대상으로 합니다. 셸 명령은 터미널에 직접 입력합니다. 한국어는 **설정 → 언어 → 한국어**에서 고릅니다.

### Gemini와 워커 협업

Google 계정으로 작업할 때는 `agy`를 설치·로그인한 뒤 **Gemini (Antigravity)**를 사용합니다. Gemini CLI는 해당 CLI가 지원하는 인증 방식으로 사용할 수 있습니다. 두 제공자의 native 로그인·대화 형식을 유지합니다. 도구 자동 모드가 로그인·신뢰·질문에 대신 답하지는 않습니다.

세션 사이에 역할을 지정하고 작업 세션에 위임을 요청합니다. 협업 설정이 연결된 Claude·Codex·Gemini CLI·agy 세션은 `atrium models`와 `atrium child`를 쓸 수 있습니다. 이름은 맡긴 일을 알아볼 수 있게 정합니다. 관리 세션 안에서 쓰는 예입니다.

```sh
atrium models
atrium child api-review --launcher Codex --prompt "API 변경을 검토하고 결과를 보고해. 파일은 수정하지 마."
atrium child docs-review --model "haiku" --effort low --prompt "문서만 검토해."
atrium children
```

말로 쓴 모델 이름도 목록에서 찾습니다. 없거나 여러 모델이 맞으면 다른 모델을 임의로 띄우지 않고 후보를 돌려줍니다. 지정하지 않은 종류와 호환 모델은 부모에게서 물려받습니다. **상한은 유지합니다:** 기본값은 세션당 직접 자식 4개, 깊이 3단계, 보드 전체 하위 세션 16개입니다. 동시에 들어온 요청도 자리를 예약해 세고, 자손만 하위 세션 명령으로 끌 수 있습니다.

Claude 워크트리 워커는 커밋이 있는 저장소에서 만듭니다. 미신뢰 저장소에서는 먼저 워크트리 옵션 없이 신뢰 질문을 띄우고 지시를 대기시킵니다. 사람이 신뢰한 사실과 패널 준비를 확인한 뒤 워크트리로 다시 띄웁니다. 그동안 `atrium child-wait <이름>`으로 기다립니다. 시간 초과를 신뢰 승인으로 취급하지 않습니다.

Gemini CLI는 별도 관리 프로필을 씁니다. Antigravity는 기존 hook을 유지하며 `atrium-board` 항목을 사용하고, 사용자가 hook을 꺼 둔 설정도 존중합니다. 완료 답변은 실제 대화 기록에서 읽고 터미널 글로 보완합니다. 아래의 명시적 가져오기 외에는 자동 기록 색인과 절전은 Claude 대상입니다.

## 고른 데스크톱 대화 가져오기

가져오기 창에는 **Claude와 Codex** 기록이 표시되며 처음에는 아무것도 선택하지 않습니다. 사용자가 고른 대화만 별도 사본으로 만듭니다. 실행 중인 데스크톱 터미널에 붙는 기능은 아닙니다.

- **Claude:** 별도 대화 스냅샷과 보드 설정을 만들고 잠든 세션으로 등록합니다. 원본 파일은 다시 쓰지 않습니다.
- **Codex:** native app-server의 목록·읽기·모델 조회와 `thread/fork`를 사용합니다. 보드 UUID와 복사한 native 대화 UUID를 따로 보존합니다. 가져오기만으로 턴을 시작하거나 원본을 재개·보관·종료하지 않습니다. 실행 중이라고 보고된 원본은 거부합니다. 별도 app-server만으로 모든 다른 클라이언트의 실행 여부를 확정할 수는 없습니다.
- 가져온 Codex 사본을 열거나 요청하면 `codex resume <사본의 대화 ID>`로 그 사본만 깨웁니다. ID를 잃었을 때 새 대화로 조용히 바꾸지 않습니다. 프로젝트를 깨워도 아직 사용하지 않은 가져오기 사본을 모두 띄우지는 않습니다.

복사본도 원본과 같은 작업 폴더를 사용할 수 있습니다. 대화 복사는 프로젝트 파일이나 워크트리 복사를 뜻하지 않습니다. 개발용 가져오기는 명시적으로 분리한 기록 위치가 필요합니다. 기존 Claude의 판 밖 기록 색인과 다른 프로세스에 묶인 대화 검사는 별도 경로로 유지합니다.

## 0.4 기능

| 영역 | 기능 |
|---|---|
| 응답 필요 | `ResponseNotice`가 질문·신뢰·로그인·오류의 맥락을 보여줍니다. 안내와 OS 알림을 누르면 실제 터미널로 갑니다. PC 승인·답변 카드를 이 동선으로 교체했습니다. |
| 이름과 위임 | 한글 표시 이름을 바꿔도 에이전트 주소는 유지합니다. 하위 제공자에 맞게 부모 권한을 변환하며 기본 상한은 직접 자식 4개·깊이 3·보드 전체 하위 16개입니다. |
| 배치와 그룹 | 같은 저장소의 여러 워크트리를 한 도킹에 묶고 워커를 열로 배치합니다. 안팎 폴더의 자동 그룹, 관계를 고려한 전체 정리·되돌리기와 틀 비율을 지키는 크기 조절을 지원합니다. |
| 절전 범위(P111) | 관리 Claude 세션은 프로젝트가 바빠도 개별 절전할 수 있습니다. 프로젝트 깨우기는 개별 절전 세션을 남겨 두고, 해당 세션을 고르면 그것만 깨웁니다. 미사용 가져오기 사본도 잠든 채 유지합니다. |
| 휴대폰과 브라우저 | 보드·미션·터미널 화면, 터치 조작, 선택적 패스키, 쿠키 로그인과 기기별 푸시를 제공합니다. 원격 접속은 기본 꺼짐입니다. |
| Mac 앱 업데이트 | 이 fork의 저장소에서 stable/dev 채널의 완성된 Mac 번들을 받아 체크섬·번들 서명·호환성을 확인한 뒤 교체합니다. |
| 유지하는 연동 | 제공자별 현재 모델 목록, Gemini/agy 기본 즐겨찾기 하나, 정확한 native ID 복구, Codex 사본, 비공개 명령·env 복원, Mac 단축키·IME와 메모·칸반·검색·요청 기록을 유지합니다. |

**도구 자동 모드**는 보드 설정 `agentAutoApprove`이며 공개 기본값은 **false**입니다. 보드에서 명시적으로 켜면 관리 Claude Code·Codex·Gemini CLI·agy의 실행·다시 열기·깨우기에 제공자별 자동 승인 옵션을 적용합니다. 전역 CLI 권한 설정을 고치거나 로그인·프로젝트 신뢰·질문에 대신 답하지 않습니다. 응답이 남으면 응답 필요 안내와 알림에서 터미널로 이동합니다.

## 여러 클라이언트와 선택적 브라우저 접속

Electron 창과 등록된 브라우저가 보드 상태를 공유합니다. 뷰포트는 클라이언트별로 저장하고, 터미널은 공유 제어기·크기 소유권·연결 세대로 오래된 응답을 구분합니다.

**브라우저·원격 접속은 기본 꺼짐입니다.** 호스트의 **연결된 기기** 설정에서 켭니다. 백엔드는 loopback에서 듣고 원격 브라우저는 명시적으로 설정한 Tailscale Serve를 거칩니다. `atrium remote status`와 `atrium remote guide`에서 절차를 봅니다. `atrium remote enable`은 변경을 미리 보여 주고 `--yes`로 허용합니다. 원격을 끄면 기기 연결·새 짝 맺기를 중지하고 푸시 구독을 지웁니다. Funnel은 사용하지 않습니다.

일회용 코드나 호스트의 승인으로 기기를 등록합니다. 브라우저 로그인은 HttpOnly·SameSite=Strict 쿠키를 사용하며 HTTPS에서는 Secure를 붙입니다. 서버에는 세션 해시를 저장합니다. **패스키 인증은 선택 사항이며 기본 꺼짐**입니다(`remotePasskey`). 켜면 보드 출처에 묶인 WebAuthn 챌린지로 등록·재로그인하고 로그인 만료·연결 종료 후 대기 시간을 적용합니다. Tailscale 사용자·기기 정책과 호스트의 등록 승인은 별도 검사입니다.

휴대폰 화면에서 보드·미션을 탐색하고 터미널을 열거나 요청을 보냅니다. 푸시는 각 기기에서 알림 권한과 구독을 허용해야 하며 해당 브라우저의 푸시 서비스를 거칩니다. 등록 기기는 호스트 터미널을 조작할 수 있어 읽기 전용 공유가 아닙니다. 폴더 선택·업로드·재연결 표시·설치형 웹 화면도 유지합니다.

## 앱 안에서 Mac 업데이트

업데이트 저장소는 [Qualop/atrium-macos](https://github.com/Qualop/atrium-macos)이며 stable/dev 채널을 구분합니다. 완성된 앱 ZIP과 SHA-256 체크섬을 받아 번들·서명·CPU·실행 환경 호환성을 확인한 뒤 별도 helper로 설치 앱을 교체하고 다시 엽니다. 교체 실패에 대비해 이전 번들을 보관합니다. 릴리스 소스나 npm 설치·빌드를 실행해 체크아웃을 덮는 방식은 아닙니다. 실제 배포 ZIP으로 앱 교체·native 창 재실행과 실패 시 자동 롤백을 검증했습니다. 각 시험에서 엔진 PID·터미널 패널·메모를 유지했습니다.

## Finder용 앱 만들기

설치 후 저장소 루트에서 실행합니다.

```sh
node app/scripts/package-macos.mjs
```

패키징 경로는 Electron, 패키징에 사용한 Node, herdr와 실행 의존성을 담은 `out/Atrium.app`을 만듭니다. Finder로 옮겨 실행합니다. 번들 내부 경로는 설치된 앱 위치를 기준으로 찾고 CLI는 받는 사람의 Mac에서 탐색합니다. 빌드한 사람의 홈 경로나 PATH를 넣지 않습니다. 사용하는 Mac의 CPU에 맞춰 빌드하고, 받는 사람도 에이전트 CLI 설치·로그인은 별도로 합니다.

임시 위치에서 패키징·서명·검사를 수행한 뒤 결과를 배치합니다. 다시 빌드할 때는 기존 결과를 옮겨 두세요. 소스를 고쳐도 이미 설치한 앱은 갱신되지 않습니다.

## 데이터·권한·종료

| macOS 데이터 | 기본 위치 |
|---|---|
| 보드 DB, 로그, 세션 설정 | `~/Library/Application Support/atrium` |
| 창 설정 | `~/Library/Application Support/atrium-app-real` |
| herdr 세션 | `~/.config/herdr/sessions/atrium` |
| 개발용 데이터 | `backend/.dev/data` |

`ATRIUM_DATA_DIR`, `ATRIUM_APP_USERDATA`, `ATRIUM_HERDR_SESSION`, `ATRIUM_PORT`로 기본값을 바꿉니다. herdr는 `XDG_CONFIG_HOME`도 따릅니다. `ATRIUM_REMOTE_ENABLED=0`은 원격 접속을 명시적으로 잠그며, 환경 변수로 지정한 값은 저장된 스위치보다 우선합니다.

프리셋 환경 변수와 비공개 runtime 값은 로컬에 저장되며 암호화된 비밀 저장소가 아닙니다. 관리 자격 증명 파일에는 제한된 권한을 적용합니다. 공개 이벤트에는 환경 변수 값을 넣지 않고 직접 명령을 가립니다. `~/.claude/settings.json`은 고치지 않습니다. 연결된 제공자는 요청과 코드를 설정된 서비스·게이트웨이로 보낼 수 있습니다.

창을 닫아도 herdr의 작업은 계속될 수 있습니다. 메뉴 막대에서 앱·백엔드·실행 엔진을 각각 제어합니다. 작업까지 끝내려면 **모든 작업과 실행 엔진 종료…**를 선택합니다. 보관은 기록을 유지하고, 지원되는 삭제는 확인 후 해당 파일을 휴지통으로 옮깁니다. 사본을 가져왔다고 원본 데스크톱 대화를 삭제하지 않습니다.

## 개발과 검증

```sh
npm --prefix backend test
npm --prefix app test
npm --prefix app run build
```

`cd app && npm run mac -- --dev`로 분리된 개발 보드를 엽니다. 격리 프로필과 Mac 통합 명령은 [시험 요령](docs/testing.md)을 따릅니다.

- Node 22.13.0·22.23.4·24.0.0·24.22.2·26.0.0·26.13.0에서 백엔드 1,101개·앱 526개와 빌드를 통과했습니다. macOS·Windows CI도 12개 조합을 통과했습니다. [CI 결과](https://github.com/Qualop/atrium-macos/actions/runs/43043273359)
- 배포 앱의 최소 PATH 실행, 실제 모델 목록, 한국어 UI·합성 IME, 터미널 9개·제어기 8개, 메모·칸반, 창 재열기, 백엔드 강제 종료 뒤 패널 복구, 앱 업데이트·실패 롤백을 확인했습니다.
- 휴대폰·패스키·푸시의 계약·브라우저 시험을 수행했습니다. 실제 iPhone·Web Push 전달·OS 알림 직접 클릭과 다른 CPU·OS 조합은 추가 실기기 확인 대상입니다.

시험은 새 임시 프로필과 합성 기록을 사용합니다. Node 지원 범위는 22.13+의 22.x, 24.x, 26.x입니다.

[설계](docs/ARCH.md), [현재 결정](docs/BRIEF.md), [계획](docs/PLAN.md)을 함께 봅니다.

## 라이선스와 외부 소프트웨어

[MIT](LICENSE). 의존성과 글꼴 고지는 [THIRD_PARTY_NOTICES](app/THIRD_PARTY_NOTICES.txt)에 있습니다. 번들에는 해당 Atrium, Electron/Chromium, Node, herdr, npm 의존성과 글꼴 고지를 유지합니다. 에이전트 이름과 로고는 도구를 구분하기 위한 표시이며 제휴나 보증을 의미하지 않습니다.
