import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../auth/decorators';
import { ENV, type Env } from '../config/env';
import { DbService } from '../db/db.service';

/**
 * PLAT-07. Liveness says "the process is up"; readiness says "send me traffic". The two are
 * separate so an unhealthy dependency removes an instance from rotation without restarting it.
 * Both are the only unauthenticated API paths (IAM exit criteria).
 */
@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly db: DbService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('healthz')
  live() {
    return { status: 'ok' };
  }

  @Get('readyz')
  async ready() {
    const dbOk = await this.db.ping(this.env.READINESS_TIMEOUT_MS);
    if (!dbOk) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        checks: { database: 'down' },
      });
    }
    return { status: 'ok', checks: { database: 'up' } };
  }
}
