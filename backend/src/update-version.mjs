// Apple requires numeric plist version fields. Full SemVer remains the release
// identity in package.json, update-manifest.json, tags, and asset filenames.
// https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring
// https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion
export function macosVersionOf(version) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-dev\.([1-9]\d*))?$/.exec(String(version));
  if (!match || match.slice(1, 4).some(value => !Number.isSafeInteger(Number(value)))) throw Object.assign(new Error(`Invalid macOS release version: ${version}. Expected x.y.z or x.y.z-dev.N (N starts at 1).`), { code: 'invalid_release_version' });
  const baseVersion = match.slice(1, 4).join('.');
  // A dev sequence is the native build number within that marketing release.
  // Updater ordering, including dev -> stable, always uses full SemVer.
  return { version, baseVersion, bundleVersion: match[4] || baseVersion, channel: match[4] ? 'dev' : 'stable' };
}
export function assertMacosVersions(version, { shortVersion, bundleVersion, appVersion, backendVersion, manifestVersion, manifestBaseVersion, manifestBundleVersion }) {
  const expected = macosVersionOf(version);
  if (shortVersion !== expected.baseVersion || bundleVersion !== expected.bundleVersion) throw new Error(`Bundle plist version mismatch: expected ${expected.baseVersion} / ${expected.bundleVersion} for ${version}.`);
  if ([appVersion, backendVersion, manifestVersion].some(value => value !== version)) throw new Error(`App/backend/update manifest release versions disagree with ${version}.`);
  if ((manifestBaseVersion !== undefined && manifestBaseVersion !== expected.baseVersion) || (manifestBundleVersion !== undefined && manifestBundleVersion !== expected.bundleVersion)) throw new Error(`Update manifest native versions disagree with ${version}.`);
  return expected;
}
