import { Body, Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ROLES } from '@cv/shared';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse, ulidSchema } from '../common/validate';
import { CurrentPrincipal, Roles } from './decorators';
import { LocalAuthService } from './local-auth.service';
import type { Principal } from './principal';

const createSchema = z.object({
  email: z.string().trim().email().max(254),
  displayName: z.string().trim().min(1).max(120),
  /** `NONE`: a report viewer. No role, so nothing but shared reports can be opened (spec 6.5). */
  role: z.enum([...ROLES, 'NONE']).default('TA_PARTNER'),
});

/** Admin-created accounts: credentials are emailed, or the admin copies a one-time setup link instead. */
@Roles('ADMIN')
@Controller('admin/users')
export class AccountsController {
  constructor(private readonly auth: LocalAuthService) {}

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @CurrentPrincipal() actor: Principal, @Req() req: FastifyRequest) {
    return this.auth.createUser(actor, parse(createSchema, body), req.ip);
  }

  @Post(':userId/reset-password')
  @HttpCode(200)
  reset(
    @Param('userId') userId: string,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.resetPassword(actor, parse(ulidSchema, userId), req.ip);
  }

  /** A one-time link the admin can copy and send by any channel; its holder chooses their own password. */
  @Post(':userId/setup-link')
  @HttpCode(200)
  setupLink(
    @Param('userId') userId: string,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.auth.issueSetupLink(actor, parse(ulidSchema, userId), req.ip);
  }

  @Post(':userId/status')
  @HttpCode(200)
  status(
    @Param('userId') userId: string,
    @Body() body: unknown,
    @CurrentPrincipal() actor: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { status } = parse(z.object({ status: z.enum(['active', 'disabled']) }), body);
    return this.auth.setStatus(actor, parse(ulidSchema, userId), status, req.ip);
  }
}
