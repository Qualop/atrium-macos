// 예시 노드만 돌려주는 고정 자료. Tailscale 실행이나 사용자 프로필 접근 없음.
const USERS = { 1: { ID: 1, LoginName: 'me@example.com', DisplayName: 'Me', ProfilePicURL: '' }, 2: { ID: 2, LoginName: 'other@example.com', DisplayName: 'Other', ProfilePicURL: '' }, 3: { ID: 3, LoginName: 'tagged-devices', DisplayName: 'Tagged Devices', ProfilePicURL: '' } };
const NODES = {
  '100.64.0.2': { ID: 102, StableID: 'nFAKE0002CNTRL', host: 'laptop-a', user: 1 },
  '100.64.0.3': { ID: 103, StableID: 'nFAKE0003CNTRL', host: 'laptop-b', user: 1 },
  '100.64.0.4': { ID: 104, StableID: 'nFAKE0004CNTRL', host: 'other-laptop', user: 2 },
  '100.64.0.9': { ID: 109, StableID: 'nFAKE0009CNTRL', host: 'server', user: 3, tags: ['tag:server'] },
};
export function fakeWhois(addr) {
  const n = NODES[addr];
  if (!n) return null;
  return {
    Node: {
      ID: n.ID, StableID: n.StableID, Name: `${n.host}.example.ts.net.`, User: n.user, Addresses: [`${addr}/32`], AllowedIPs: [`${addr}/32`],
      ...(n.tags ? { Tags: n.tags } : {}), Hostinfo: { Hostname: n.host }, MachineAuthorized: true, ComputedName: n.host, ComputedNameWithHost: n.host,
    },
    UserProfile: USERS[n.user],
    CapMap: {},
  };
}
