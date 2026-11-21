import { type CanActivate, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ENV, type Env } from '../../config/env';

export const ORACLE_NOT_AVAILABLE = 'Oracle import is not available in this environment.';

/**
 * Stage 3, S3-INT-03 (plan 15.3 note 5): the one switch. With `ORACLE_IMPORT_ENABLED` not 'true',
 * every Oracle route answers 404 ORACLE_NOT_AVAILABLE and writes nothing. Controllers are always
 * registered (AppModule is built before a test sets its environment); this guard decides per call.
 * The global sign-in and role guards run first, so only a signed-in user with the right role sees it.
 */
@Injectable()
export class OracleEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(): boolean {
    if (this.env.ORACLE_IMPORT_ENABLED !== 'true')
      throw new NotFoundException({ message: ORACLE_NOT_AVAILABLE, code: 'ORACLE_NOT_AVAILABLE' });
    return true;
  }
}
