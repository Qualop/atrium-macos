상태: 열림
날짜: 2026-11-03

## 지시

Gemini CLI를 Atrium에서 모델 선택·세션 실행·상호 리뷰·하위 세션 생성까지 연결한다. 기존 사용자 세션과 개인 설정을 유지하고 별도 환경에서 검증한다. 설치된 macOS 앱과 공개 저장소 문서를 갱신한다.

## 작업 기록

- Gemini CLI 0.66.0 공식 패키지 설치. Google 계정 인증은 사용자가 직접 진행한다.
- 기존 역할 선과 전달 대기열은 종류와 무관하지만, 셸 도구 호출 추적과 하위 세션 인증은 Claude 중심이었다. Gemini의 BeforeAgent/AfterAgent/BeforeTool/AfterTool을 기존 이벤트로 변환한다.
- 실제 CLI는 root 소유가 아닌 system-defaults를 거부했다. Gemini는 GEMINI_CLI_HOME에 별도 settings.json을 두고 기존 인증·기록은 심볼릭 링크로 참조한다. 인증 파일 내용은 복사하지 않는다. 신뢰·승인 모드를 바꾸지 않는다.
- Gemini transcript는 Claude JSONL 처리기에 넘기지 않는다. 완료 응답은 별도 이벤트로 보관하여 출력·역할 기록·반복 작업에 사용한다.
- Gemini가 시작되거나 승인 대기 중일 때 첫 지시가 로그인 화면으로 들어가지 않도록 준비 상태를 확인한다.
- 하위 세션은 부모 종류를 기본값으로 사용하며, 다른 제공자 모델을 잘못 상속하지 않는다. 명시한 모델은 Codex/Gemini에도 전달한다.
- 앱을 다시 열 때 Gemini의 동일 대화를 지정해 복구한다. 마지막 대화를 임의로 선택하는 latest 방식은 쓰지 않는다.

## 보고

- 백엔드 353개, 화면 80개 통과. renderer 빌드, 문서 규약, diff 검사 통과.
- 설치본 macOS 시험: Gemini CLI 모델 14개·Codex 모델 8개, Google 제공자 선택(payload는 fixture), 한국어, 터미널 입력, 창/백엔드 재시작 검증. 실제 설치 앱 API에서는 agy 모델 6개 조회 성공.
- 실제 Gemini CLI 0.66.0 + 로컬 가짜 모델 서버: 세션 프로필·hook·최종 답·정확한 ID 이어 가기 성공. 실제 계정 토큰을 사용한 모델 추론 시험은 아니다.
- Claude→Gemini/agy 및 Gemini/agy→Codex 요청 추적은 백엔드 처리기와 SQLite 계약 시험으로 검증했다.
- 실제 agy 초기 설정 화면이 herdr에서 idle로 보이는 문제를 발견했다. 테스트 세션을 중단하고 보드 대기열 전송 직전 실제 입력창 footer를 확인하도록 보완했다. 초기 동의·테마·로그인 화면에는 메시지와 Enter를 보내지 않는다.
- 설치된 /Applications/Atrium.app 반영·서명 검증·최소 PATH 시험 완료. 설치 전 코드는 /tmp/atrium-google-backup-McU5tS에 백업했다.
- Gemini CLI 개인 OAuth는 인증 후 서비스에서 UNSUPPORTED_CLIENT로 거절됨을 실제 화면과 공식 저장소 보고로 확인했다. Google 개인 계정 경로는 Antigravity CLI 1.4.12(공식 설치 스크립트·체크섬 검증)로 추가했다. agy는 공용 hooks.json에 명명된 조건부 항목이 필요하다. 실제 계정 모델의 상호 리뷰는 Antigravity 인증 후 별도 확인이 필요하다.
