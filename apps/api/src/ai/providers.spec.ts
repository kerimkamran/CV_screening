import { isPrivateAddress, normaliseBaseUrl, validateBaseUrl } from './providers';

describe('outbound address safety for admin-supplied base URLs', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    'fd00::1',
    'fe80::1',
    '::ffff:10.0.0.1',
  ])('treats %s as private', (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(['8.8.8.8', '104.18.7.1', '172.32.0.1', '2606:4700::1111'])('allows %s', (ip) =>
    expect(isPrivateAddress(ip)).toBe(false),
  );

  it('accepts a normal https base URL and normalises it', () => {
    expect(normaliseBaseUrl('https://api.mistral.ai/v1/')).toBe('https://api.mistral.ai/v1');
    expect(normaliseBaseUrl('https://API.Example.com/openai/v1///?x=1#y')).toBe(
      'https://api.example.com/openai/v1',
    );
  });

  it.each([
    'http://api.example.com',
    'https://localhost',
    'https://intranet',
    'https://db.internal',
    'https://1.2.3.4/v1',
    'https://[::1]/v1',
    'https://u:p@api.example.com',
    'https://api.example.com:9000',
    'not a url',
  ])('rejects %s', (u) => expect(() => validateBaseUrl(u)).toThrow());
});
