import { Global, Module } from '@nestjs/common';
import { AiAdminController } from './ai-admin.controller';
import { AiGateway } from './ai-gateway.service';
import { SettingsCrypto } from './settings-crypto';

@Global()
@Module({
  controllers: [AiAdminController],
  providers: [SettingsCrypto, AiGateway],
  exports: [AiGateway, SettingsCrypto],
})
export class AiModule {}
