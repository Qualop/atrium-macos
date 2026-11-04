// SQLite is available without an experimental flag from Node 22.13.0.
// Support the maintained LTS lines; prerelease/odd EOL lines are not advertised.
export const NODE_RANGE = '^22.13.0 || ^24.0.0 || ^26.0.0';
export const NODE_REQUIREMENT = 'Node.js 22.13+ (22.x), 24.x 또는 26.x';
export function supportedNode(version = process.versions.node) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(version));
  if (!match) return false;
  const major = Number(match[1]), minor = Number(match[2]);
  return (major === 22 && minor >= 13) || major === 24 || major === 26;
}
export function requireSupportedNode(version = process.versions.node) {
  if (!supportedNode(version)) throw new Error(`${NODE_REQUIREMENT}가 필요합니다. 현재: ${version}`);
}
