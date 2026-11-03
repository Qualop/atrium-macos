상태: 닫힘
날짜: 2026-11-04

## 지시

전체 기능 검토를 올린 뒤 GitHub의 macOS·Windows 자동 시험 결과를 확인하고 실패 원인을 수정한다.

## 작업 기록

f597b0b의 macOS 작업은 통과했다. Windows는 6개 테스트에서 실패했다. hook 시험 실행 경로에 URL.pathname을 사용하여 D:\\D:\\...가 만들어졌고, POSIX mode 0600을 Windows stat에도 기대했다. git 시험의 임시 폴더는 옛 realpathSync로 정리해 RUNNER~1 경로가 남았으나 실제 앱은 realpathSync.native로 긴 경로를 사용했다.

## 보고

- hook 실행 경로는 fileURLToPath로 변환한다. 드라이브 문자뿐 아니라 공백·유니코드 URL 인코딩도 정상 처리한다.
- 파일 0600 검사는 POSIX에서만 수행한다. Windows 파일 보호는 ACL 체계이므로 숫자 mode 일치로 검증하지 않는다. 나머지 hook 계약 시험은 그대로 실행한다.
- git 시험의 임시 폴더도 실제 앱과 같은 native 경로 정규화를 사용한다.
- 실패한 기능을 제외하지 않고 각 플랫폼의 올바른 경로·권한 의미에 맞춰 시험을 수정했다. 실제 Windows GUI·IME 시험을 대체하지는 않는다.
