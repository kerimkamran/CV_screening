import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { AssistantAdminController } from './assistant-admin.controller';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';
import { PoolAssistantService } from './pool-assistant.service';
import { PoolSearch } from './senai/search';
import { DeepTools } from './senai/deep-tools';
import { PoolTools } from './senai/tools';

@Module({
  imports: [VacancyModule, PipelineModule],
  controllers: [AssistantController, AssistantAdminController],
  providers: [AssistantService, PoolAssistantService, PoolSearch, PoolTools, DeepTools],
  exports: [AssistantService, PoolAssistantService],
})
export class AssistantModule {}
