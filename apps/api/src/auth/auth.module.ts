import { Module, type OnApplicationBootstrap } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SettingsCrypto } from '../ai/settings-crypto';
import { AccountsController } from './accounts.controller';
import { AdminController } from './admin.controller';
import { AuthGuard, RolesGuard } from './auth.guard';
import { EmailService } from './email.service';
import { LocalAuthService } from './local-auth.service';
import { MeController } from './me.controller';
import { MfaController } from './mfa.controller';
import { SessionController } from './session.controller';
import { jwksResolverFactory, TokenVerifier } from './token-verifier';
import { DbUserDirectory, USER_DIRECTORY } from './user-directory';

@Module({
  controllers: [
    MfaController,
    MeController,
    AdminController,
    AccountsController,
    SessionController,
  ],
  providers: [
    jwksResolverFactory,
    TokenVerifier,
    EmailService,
    LocalAuthService,
    SettingsCrypto,
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
