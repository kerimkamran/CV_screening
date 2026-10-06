import { Body, Controller, Get, HttpCode, Put } from '@nestjs/common';
import { z } from 'zod';
import { parse } from '../common/validate';
import { DbService } from '../db/db.service';
import { AnyAuthenticated, CurrentPrincipal } from './decorators';
import type { Principal } from './principal';

/** Page backgrounds (design spec 4.2). `null` means "match my device". */
export const BACKGROUNDS = ['white', 'grey', 'sky', 'dark'] as const;
export type Background = (typeof BACKGROUNDS)[number];

@Controller()
export class MeController {
  constructor(private readonly db: DbService) {}

  /** Who does the API think I am, and what may I do? Works for a user with no roles yet. */
  @AnyAuthenticated()
  @Get('me')
  async me(@CurrentPrincipal() principal: Principal) {
    const { rows } = await this.db.query<{ background: Background }>(
      `SELECT background FROM user_preference WHERE user_id = $1`,
      [principal.userId],
    );
    return { ...principal, background: rows[0]?.background ?? null };
  }

  /** Stores the person's background choice; `null` clears it so the page follows the device. */
  @AnyAuthenticated()
  @Put('me/preferences')
  @HttpCode(200)
  async preferences(@Body() body: unknown, @CurrentPrincipal() principal: Principal) {
    const { background } = parse(z.object({ background: z.enum(BACKGROUNDS).nullable() }), body);
    if (background === null) {
      await this.db.query(`DELETE FROM user_preference WHERE user_id = $1`, [principal.userId]);
    } else {
      await this.db.query(
        `INSERT INTO user_preference (user_id, background) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET background = EXCLUDED.background, updated_at = now()`,
        [principal.userId, background],
      );
    }
    return { background };
  }
}
