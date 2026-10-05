import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsController } from './accounts.controller';
import { AdminController } from './admin.controller';
import { AuthGuard, RolesGuard } from './auth.guard';
import { EmailService } from './email.service';
import { LocalAuthService } from './local-auth.service';
import { MeController } from './me.controller';
import { SessionController } from './session.controller';
import { jwksResolverFactory, TokenVerifier } from './token-verifier';
import { DbUserDirectory, USER_DIRECTORY } from './user-directory';

@Module({
  controllers: [MeController, AdminController, AccountsController, SessionController],
  providers: [
    jwksResolverFactory,
    TokenVerifier,
    EmailService,
    LocalAuthService,
    { provide: USER_DIRECTORY, useClass: DbUserDirectory },
    // Order matters: authenticate first, then authorise.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [EmailService],
})
export class AuthModule implements OnApplicationBootstrap {
  constructor(private readonly local: LocalAuthService) {}

  onApplicationBootstrap() {
    return this.local.bootstrapAdmin();
  }
}
