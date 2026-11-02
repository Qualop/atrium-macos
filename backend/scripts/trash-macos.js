// osascript -l JavaScript. Finder 자동화 권한 없이 macOS 휴지통 API를 사용한다.
ObjC.import('Foundation');
function run(argv) {
  const trashed = [], failed = [];
  for (const p of JSON.parse(argv[0])) {
    const error = Ref();
    const ok = $.NSFileManager.defaultManager.trashItemAtURLResultingItemURLError($.NSURL.fileURLWithPath(p), null, error);
    if (ok) trashed.push(p);
    else failed.push({ path: p, error: error[0] ? ObjC.unwrap(error[0].localizedDescription) : 'Unable to move to Trash' });
  }
  return JSON.stringify({ trashed, failed });
}
