// Bundle-specific copy lives alongside the updater so neither source installs
// nor verification failures promise an unsupported source auto-update route.
const text = {
  en: {
    manual: 'Download macOS app', source_install: 'This is a source checkout. Use a macOS release ZIP or DMG for in-app updates.',
    macos_only: 'In-app installation supports the macOS app.', dev_profile: 'Open the installed app’s real board to update.',
    move_to_applications: 'Move Atrium.app to Applications and reopen it before updating.', bundle_not_writable: 'Move Atrium.app to a writable Applications folder, then reopen it.',
    no_bundle_asset: 'This release has no verified bundle for this Mac yet.', data_in_bundle: 'Move board data outside Atrium.app before updating.',
    note: 'Updates verify SHA256 and the app signature, then restart Atrium and its backend. Board data and herdr sessions stay in place. A failed backend health check restores the previous app.',
    confirm: 'Download and verify the macOS app, then restart. Your board and herdr sessions stay in place. Failed health checks restore the previous app.',
    stale: 'The release or channel changed. Cancel and select the update again.',
    download: 'Downloading macOS app…', checksum: 'Verifying SHA256…', extract: 'Unpacking app…', verify: 'Verifying signature and bundled runtimes…', ready: 'App verified; preparing restart…',
    verified: 'SHA256 and app signature verified', remaining: 'The update could not finish. The previous app is unchanged.', recovery: 'Automatic recovery needs attention. The saved app is available at:',
  },
  ko: {
    manual: 'macOS 앱 다운로드', source_install: '소스에서 실행 중입니다. 앱 내 업데이트는 macOS 릴리스 ZIP 또는 DMG로 설치한 앱에서 지원합니다.',
    macos_only: '앱 내 설치는 macOS 앱에서 지원합니다.', dev_profile: '설치한 앱의 실제 보드에서 업데이트하세요.',
    move_to_applications: 'Atrium.app을 응용 프로그램 폴더로 옮긴 뒤 다시 열어 업데이트하세요.', bundle_not_writable: '쓰기 가능한 응용 프로그램 폴더로 Atrium.app을 옮긴 뒤 다시 여세요.',
    no_bundle_asset: '아직 이 Mac에서 설치할 수 있는 앱 번들이 없는 릴리스입니다.', data_in_bundle: '보드 데이터를 Atrium.app 밖으로 옮긴 뒤 업데이트하세요.',
    note: 'SHA256과 앱 서명을 확인한 뒤 Atrium과 백엔드를 다시 시작합니다. 보드 데이터와 herdr 세션은 유지합니다. 새 백엔드의 상태 확인에 실패하면 이전 앱으로 복원합니다.',
    confirm: 'macOS 앱을 받아 검증한 뒤 다시 시작합니다. 보드와 herdr 세션은 유지합니다. 상태 확인에 실패하면 이전 앱으로 복원합니다.',
    stale: '릴리스 또는 채널이 바뀌었습니다. 취소한 뒤 업데이트를 다시 선택하세요.',
    download: 'macOS 앱 받는 중…', checksum: 'SHA256 확인 중…', extract: '앱 압축 푸는 중…', verify: '서명과 번들 런타임 확인 중…', ready: '앱 검증 완료 · 다시 시작 준비 중…',
    verified: 'SHA256 및 앱 서명 확인 완료', remaining: '업데이트를 마치지 못했습니다. 이전 앱은 바뀌지 않았습니다.', recovery: '자동 복원을 마치지 못했습니다. 이전 앱을 보존한 위치:',
  },
};
export const macUpdateText = (language, key) => (text[language] || text.en)[key] || text.en[key] || '';
export const confirmationMatches = (asking, view, channel) => !!asking && asking.tag === view?.latest?.tag && asking.channel === channel;
