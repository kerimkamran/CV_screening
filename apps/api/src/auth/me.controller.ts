import { Controller, Get } from '@nestjs/common';
import { AnyAuthenticated, CurrentPrincipal } from './decorators';
import type { Principal } from './principal';

@Controller()
export class MeController {
  /** Who does the API think I am, and what may I do? Works for a user with no roles yet. */
  @AnyAuthenticated()
  @Get('me')
  me(@CurrentPrincipal() principal: Principal) {
    return principal;
  }
}
