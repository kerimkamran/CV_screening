import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { AssistantAdminController } from './assistant-admin.controller';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

@Module({
  imports: [VacancyModule, PipelineModule],
  controllers: [AssistantController, AssistantAdminController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}
