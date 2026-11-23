import { normaliseAddress, oracleOrigin, ownHosts, resolvesPublic } from './oracle-address';
import { ALLOWED_FIELDS, dataQuery, FIELDS, itemLink, retryAfter } from './oracle-hcm.client';
import { categoryKey, isRsaPrivateKey, signAssertion } from './oracle-connection.service';
import { generateKeyPairSync, verify } from 'node:crypto';

// Stage 3, S3-INT-07 (1), (2), (3) and (13).
describe('the pasted-address rule', () => {
  it('keeps only the origin of an Oracle address, with or without a path or scheme (1)', () => {
    const want = 'https://xxxx.fa.em2.oraclecloud.com';
    expect(oracleOrigin('https://xxxx.fa.em2.oraclecloud.com')).toBe(want);
    expect(
      oracleOrigin(
        'https://xxxx.fa.em2.oraclecloud.com/hcmRestApi/resources/11.13.18.05/recruitingJobRequisitions?onlyData=true',
      ),
    ).toBe(want);
    expect(oracleOrigin('xxxx.fa.em2.oraclecloud.com')).toBe(want);
    expect(oracleOrigin('  https://XXXX.fa.em2.oraclecloud.com/  ')).toBe(want);
  });

  it('refuses every other address with no network call (2)', () => {
    for (const bad of [
      'http://xxxx.fa.em2.oraclecloud.com',
      'https://oraclecloud.com.evil.example',
      'https://evil-oraclecloud.com',
      'https://user:pw@xxxx.fa.em2.oraclecloud.com',
      'https://xxxx.fa.em2.oraclecloud.com:8443',
      'https://10.0.0.5',
      'https://[::1]',
      'ftp://xxxx.oraclecloud.com',
      '',
      42,
    ])
      expect(oracleOrigin(bad)).toBeNull();
    expect(normaliseAddress('not a url at all ::')).toBeNull();
  });

  it('refuses a host that resolves to a private, loopback or metadata address (3)', async () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254'])
      expect(await resolvesPublic('x.fa.em2.oraclecloud.com', async () => [ip])).toBe(false);
    expect(
      await resolvesPublic('x.fa.em2.oraclecloud.com', async () => ['203.0.113.10', '10.1.1.1']),
    ).toBe(false);
    expect(await resolvesPublic('x.fa.em2.oraclecloud.com', async () => ['8.8.8.8'])).toBe(true);
    expect(
      await resolvesPublic('x.fa.em2.oraclecloud.com', async () => {
        throw new Error('ENOTFOUND');
      }),
    ).toBe(false);
  });
});

describe('the field allow-list (13)', () => {
  it('holds no name, e-mail, phone or address field', () => {
    const nameLike = [...ALLOWED_FIELDS].filter((f) => /name|mail|phone|address/i.test(f)).sort();
    expect(nameLike).toEqual(['CategoryName', 'FileName', 'PhaseName', 'StateName']);
    for (const banned of [
      'FirstName',
      'LastName',
      'FullName',
      'Email',
      'EmailAddress',
      'PhoneNumber',
      'AddressLine1',
    ])
      expect(ALLOWED_FIELDS.has(banned)).toBe(false);
  });

  it('throws before anything is sent for a call without fields or with a field outside the list', () => {
    expect(() => dataQuery({ limit: '1' }, [])).toThrow(/names its fields/);
    expect(() => dataQuery({ limit: '1' }, ['JobApplicationId', 'EmailAddress'])).toThrow(
      /not allowed/,
    );
    const q = dataQuery({ limit: '1' }, FIELDS.requisition);
    expect(q.get('fields')).toBe('RequisitionId,RequisitionNumber,Title,StateName');
    expect(q.get('onlyData')).toBe('true');
  });

  it('reads Retry-After in seconds and as an HTTP date', () => {
    expect(retryAfter('7')).toBe(7);
    expect(retryAfter(null)).toBeUndefined();
    const soon = new Date(Date.now() + 5_000).toUTCString();
    expect(retryAfter(soon)).toBeGreaterThanOrEqual(3);
  });
});

// Gap fixes from the Oracle developer review.
describe('own Oracle hosts, links, categories and the assertion', () => {
  const ORIGIN = 'https://xxxx.fa.em2.oraclecloud.com';

  it('allows an own host only when it is listed, with every other rule kept (gap 4)', () => {
    const own = ownHosts(' HCM.Azerconnect.az ,bad host, 10.0.0.5, ,oracle.example.org');
    expect([...own]).toEqual(['hcm.azerconnect.az', 'oracle.example.org']);
    expect(oracleOrigin('https://hcm.azerconnect.az/hcmRestApi', own)).toBe(
      'https://hcm.azerconnect.az',
    );
    expect(oracleOrigin('https://hcm.azerconnect.az')).toBeNull();
    for (const bad of [
      'http://hcm.azerconnect.az',
      'https://hcm.azerconnect.az:8443',
      'https://evil.hcm.azerconnect.az',
      'https://hcm.azerconnect.az.evil.example',
    ])
      expect(oracleOrigin(bad, own)).toBeNull();
  });

  it('follows an item link only on the saved origin and under the REST path (gap 1)', () => {
    const item = {
      links: [
        {
          rel: 'self',
          href: `${ORIGIN}/hcmRestApi/resources/11.13.18.05/x/child/attachments/00AB`,
        },
        {
          rel: 'enclosure',
          name: 'FileContents',
          href: `${ORIGIN}/hcmRestApi/resources/11.13.18.05/x/child/attachments/00AB/enclosure/FileContents?y=1`,
        },
        { rel: 'other', href: 'https://elsewhere.example/hcmRestApi/resources/11.13.18.05/z' },
      ],
    };
    expect(itemLink(item, ORIGIN, { rel: 'self' })?.pathname).toMatch(/attachments\/00AB$/);
    expect(itemLink(item, ORIGIN, { rel: 'enclosure', name: 'FileContents' })?.search).toBe('');
    expect(itemLink(item, ORIGIN, { rel: 'other' })).toBeNull();
    expect(
      itemLink({ links: [{ rel: 'self', href: `${ORIGIN}/cs/idcplg` }] }, ORIGIN, { rel: 'self' }),
    ).toBeNull();
    expect(itemLink({}, ORIGIN, { rel: 'self' })).toBeNull();
    // The attachment list keeps links: no onlyData, fields still checked.
    const q = dataQuery({ limit: '100' }, FIELDS.attachment, { links: true });
    expect(q.has('onlyData')).toBe(false);
    expect(ALLOWED_FIELDS.has('CandidateNumber')).toBe(true);
  });

  it('compares categories without case, spaces, hyphens or underscores (gap 2)', () => {
    expect(categoryKey('IRC_CANDIDATE_RESUME')).toBe(categoryKey('irc candidate-resume'));
    expect(categoryKey('Curriculum Vitae')).toBe(categoryKey('CURRICULUM_VITAE'));
    expect(categoryKey('Cover Letter')).not.toBe(categoryKey('Resume'));
  });

  it('signs the documented RS256 assertion: kid, sub, iss, audience, 5 minutes (gap 3)', () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(isRsaPrivateKey(pem)).toBe(true);
    expect(isRsaPrivateKey('-----BEGIN PRIVATE KEY-----\nnope\n-----END PRIVATE KEY-----')).toBe(
      false,
    );
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    expect(isRsaPrivateKey(ec.export({ type: 'pkcs8', format: 'pem' }).toString())).toBe(false);
    const jwt = signAssertion(
      pem,
      { sub: 'parallax.integration', iss: 'client-1', kid: 'alias' },
      1_000,
    );
    const [h, b, sig] = jwt.split('.');
    expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      kid: 'alias',
    });
    expect(JSON.parse(Buffer.from(b!, 'base64url').toString())).toMatchObject({
      sub: 'parallax.integration',
      iss: 'client-1',
      aud: ['https://identity.oraclecloud.com/'],
      iat: 1_000,
      exp: 1_300,
    });
    expect(
      verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(sig!, 'base64url')),
    ).toBe(true);
  });
});
