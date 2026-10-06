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
    const { rows } = await this.db.query<{ background: Background | null; focus: boolean }>(
      `SELECT background, focus_on_skills AS focus FROM user_preference WHERE user_id = $1`,
      [principal.userId],
    );
    return {
      ...principal,
      background: rows[0]?.background ?? null,
      focusOnSkills: rows[0]?.focus ?? false,
    };
  }

  /**
   * Stores the person's display choices. `background: null` clears it so the page follows the
   * device; `focusOnSkills` is the recruiter's own switch (design spec 6.2.6). Send either or both.
   */
  @AnyAuthenticated()
  @Put('me/preferences')
  @HttpCode(200)
  async preferences(@Body() body: unknown, @CurrentPrincipal() principal: Principal) {
    const b = parse(
      z
        .object({
          background: z.enum(BACKGROUNDS).nullable().optional(),
          focusOnSkills: z.boolean().optional(),
        })
        .refine(
          (x) => x.background !== undefined || x.focusOnSkills !== undefined,
          'nothing to save',
        ),
      body,
    );
    await this.db.query(
      `INSERT INTO user_preference (user_id, background, focus_on_skills)
       VALUES ($1, $2, COALESCE($4, false))
       ON CONFLICT (user_id) DO UPDATE SET
         background = CASE WHEN $3 THEN EXCLUDED.background ELSE user_preference.background END,
         focus_on_skills = COALESCE($4, user_preference.focus_on_skills),
         updated_at = now()`,
      [principal.userId, b.background ?? null, b.background !== undefined, b.focusOnSkills ?? null],
    );
    await this.db.query(
      `DELETE FROM user_preference WHERE user_id = $1 AND background IS NULL AND focus_on_skills = false`,
      [principal.userId],
    );
    const { rows } = await this.db.query<{ background: Background | null; focus: boolean }>(
      `SELECT background, focus_on_skills AS focus FROM user_preference WHERE user_id = $1`,
      [principal.userId],
    );
    return { background: rows[0]?.background ?? null, focusOnSkills: rows[0]?.focus ?? false };
  }
}
