import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './config/env';
import { AiModule } from './ai/ai.module';
import { AssistantModule } from './assistant/assistant.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { DbModule } from './db/db.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { VacancyModule } from './vacancy/vacancy.module';
import { HealthController } from './health/health.controller';

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: () => loadEnv() }],
  exports: [ENV],
})
class ConfigModule {}

@Module({
  imports: [
    ConfigModule,
    DbModule,
    AuditModule,
    AuthModule,
    AiModule,
    VacancyModule,
    PipelineModule,
    AssistantModule,
    MonitoringModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
