import { DbService } from './db.service';

const query = jest.fn();
const end = jest.fn().mockResolvedValue(undefined);
jest.mock('pg', () => ({ Pool: jest.fn().mockImplementation(() => ({ query, end })) }));

const env = { DATABASE_URL: 'postgres://h/d', DB_POOL_MAX: 2 } as never;

describe('DbService.ping', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is true when the database answers', async () => {
    query.mockResolvedValue({ rows: [{ '?column?': 1 }] });
    await expect(new DbService(env).ping(500)).resolves.toBe(true);
  });

  it('is false when the query fails', async () => {
    query.mockRejectedValue(new Error('ECONNREFUSED'));
    await expect(new DbService(env).ping(500)).resolves.toBe(false);
  });

  it('is false when the database does not answer within the budget', async () => {
    query.mockReturnValue(new Promise(() => undefined));
    await expect(new DbService(env).ping(20)).resolves.toBe(false);
  });

  it('closes the pool on shutdown', async () => {
    await new DbService(env).onModuleDestroy();
    expect(end).toHaveBeenCalled();
  });
});
