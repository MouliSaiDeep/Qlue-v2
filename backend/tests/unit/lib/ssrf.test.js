const dns = require('node:dns').promises;
const { parseUrl, isBlockedAddress, pinnedLookup, safeFetch } = require('../../../src/lib/ssrf');

test.each([
  '127.0.0.1', '10.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1',
  '0.0.0.0', '224.0.0.1', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1',
  'fc00::1', 'fe80::1', '64:ff9b::7f00:1',
])('outbound URL protection blocks nonpublic address %s', address => {
  expect(isBlockedAddress(address)).toBe(true);
});
test.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('allows globally routable address %s', address => {
  expect(isBlockedAddress(address)).toBe(false);
});
test.each(['file:///etc/passwd', 'https://127.0.0.1/', 'http://2130706433/', 'http://0x7f000001/',
  'http://[::ffff:7f00:1]/', 'https://example.com:8443/', 'https://user:password@example.com/'])('rejects unsafe URL form %s', url => {
  expect(() => parseUrl(url)).toThrow();
});
test('outbound URL admission rejects nonstring and excessively long input before DNS', () => {
  for(const raw of [null, {}, 123, 'https://example.com/'+'x'.repeat(4096)])expect(()=>parseUrl(raw)).toThrow();
});
test('mixed public/private DNS answers fail closed in scalar and all-address lookup modes', async () => {
  const lookup = jest.spyOn(dns, 'lookup').mockResolvedValue([
    { address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 },
  ]);
  try {
    for (const options of [{ all: true }, { family: 4 }]) {
      await expect(new Promise((resolve, reject) => pinnedLookup('example.test', options,
        (error, result) => error ? reject(error) : resolve(result)))).rejects.toThrow('private');
    }
    await expect(safeFetch('https://example.test/')).rejects.toThrow('private');
  } finally { lookup.mockRestore(); }
});
test('pinned DNS lookup honors modern all-address and legacy scalar contracts', async () => {
  const lookup = jest.spyOn(dns, 'lookup').mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  try {
    await expect(new Promise((resolve, reject) => pinnedLookup('example.test', { all: true },
      (error, result) => error ? reject(error) : resolve(result)))).resolves.toEqual([{ address: '8.8.8.8', family: 4 }]);
    await expect(new Promise((resolve, reject) => pinnedLookup('example.test', 4,
      (error, address, family) => error ? reject(error) : resolve({ address, family })))).resolves.toEqual({ address: '8.8.8.8', family: 4 });
  } finally { lookup.mockRestore(); }
});
