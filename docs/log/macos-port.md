상태: 닫힘
날짜: 2026-11-02

## 지시

Windows 전용 Atrium을 macOS로 가능한 범위까지 포팅하고, 발견한 버그를 수정한다. 기존 사용자 대화와 설정을 변경하지 않고 새 시험 프로필에서 검증한다.

## 작업 기록

- 기준: Gudals0320/atrium main 2ce4056.
- 공식 herdr v0.9.5 소스 2ecf19a92fc3a7fff75b6ce3655ef04f4625ec01에서 macOS 세션 경로와 Unix 소켓 규약을 확인했다. 최신 Herdr App/herdr-core 대신 기존 TUI 프로토콜 22를 유지한다.
- platform.mjs로 데이터 폴더, 실행 파일 검색, herdr 경로와 소켓을 분리했다. POSIX 경로의 앞 슬래시·대소문자와 기존 Windows 경로 자료를 구분하고, 실제 폴더의 심볼릭 링크를 정규화한다.
- POSIX ps 기반 자원·자식 프로세스·Claude 프로세스 조회, zsh 프롬프트, macOS Claude 데스크톱 대화 위치, NSFileManager 휴지통 API를 추가했다.
- Electron macOS 실행 경로, 메뉴 편집 역할, Dock 재열기, Command 복사·붙여넣기를 적용했다.
- 전송 중 종료된 메시지의 복구 시각을 저장해 확인 대기열이 영구히 막히는 문제를 고쳤다. API 요청 시간 초과와 전송 예외 정리도 추가했다.
- 프로젝트 내부 설치·실행 명령과 macOS/Windows 테스트 CI를 추가했다. 설치 파일은 공식 릴리스 체크섬으로 검증하며 사용자 전역 설정은 바꾸지 않는다.

## 보고

Apple Silicon macOS, Node 24.15.0, herdr 0.9.5에서 검증했다.

- 백엔드 단위 시험: 263개 통과, 실패 0.
- 화면 단위 시험: 68개 통과, 실패 0. esbuild 빌드 통과.
- 문서 규약과 git diff --check 통과.
- npm run setup:mac으로 공식 바이너리 체크섬·의존성 설치를 검증했다. 다음 실행은 app 폴더에서 npm run mac이다.
- 실제 Electron 통합 시험: 백엔드·herdr 연결, 새 셸 생성, 키보드 입력과 xterm 출력, 세션 안 herdr 실행, 창 닫기·재열기, 백엔드 종료 후 동일 pane 재연결, 시험 세션 종료 통과. renderer 오류 없음.
- 새 Claude CLI 시작 화면을 확인했다. 신뢰 확인은 수락하지 않았고, 모델 호출·실제 코딩 작업은 수행하지 않았다.
- 한글·따옴표가 들어간 새 시험 파일을 NSFileManager로 휴지통에 보냈다.
- 시험 프로세스가 남아 있지 않음을 확인했다. 결과 로그·화면은 backend/.dev/verification/에 보관한다(git 제외).

제한: Intel Mac 실기기와 Windows 회귀 실행은 하지 않았다(CI 설정만 추가). 실제 한글 IME 조합, OS 알림 클릭, PC 재부팅 복구, Codex·DeepSeek의 실제 모델 작업은 별도 검증이 필요하다. 서명·공증된 앱이나 DMG는 만들지 않았다. 긴 대화 파일의 동기 읽기 방식은 유지한다.
