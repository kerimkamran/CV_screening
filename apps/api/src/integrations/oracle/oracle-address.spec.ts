import { normaliseAddress, oracleOrigin, resolvesPublic } from './oracle-address';
import { ALLOWED_FIELDS, dataQuery, FIELDS, retryAfter } from './oracle-hcm.client';

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
