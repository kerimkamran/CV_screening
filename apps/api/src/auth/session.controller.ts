import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { parse } from '../common/validate';
import { AnyAuthenticated, CurrentPrincipal, Public } from './decorators';
import { LocalAuthService } from './local-auth.service';
import type { Principal } from './principal';

/** Built-in sign-in. All routes answer 404 unless AUTH_MODE=local. */
@Controller('auth')
export class SessionController {
  constructor(private readonly auth: LocalAuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: unknown, @Req() req: FastifyRequest) {
    const { email, password } = parse(
      z.object({ email: z.string().max(254), password: z.string().min(1).max(256) }),
      body,
    );
    return this.auth.login(email, password, req.ip);
  }

  @AnyAuthenticated()
  @Post('refresh')
  @HttpCode(200)
  refresh(@CurrentPrincipal() p: Principal) {
    return this.auth.refresh(p);
  }

  @AnyAuthenticated()
  @Post('change-password')
  @HttpCode(200)
  change(@Body() body: unknown, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const { currentPassword, newPassword } = parse(
      z.object({ currentPassword: z.string().min(1).max(256), newPassword: z.string().max(256) }),
      body,
    );
    return this.auth.changePassword(p, currentPassword, newPassword, req.ip);
  }
}
