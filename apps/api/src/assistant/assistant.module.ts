import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module';
import { VacancyModule } from '../vacancy/vacancy.module';
import { AssistantAdminController } from './assistant-admin.controller';
import { AssistantController } from './assistant.controller';
import { LinkReviewController } from './link-review.controller';
import { AssistantService } from './assistant.service';
import { PoolAssistantService } from './pool-assistant.service';
import { PoolSearch } from './senai/search';
import { DeepTools } from './senai/deep-tools';
import { LinkReviewService } from './senai/link-review.service';
import { SkillsService } from './senai/skills.service';
import { PoolTools } from './senai/tools';

@Module({
  imports: [VacancyModule, PipelineModule],
  controllers: [AssistantController, AssistantAdminController, LinkReviewController],
  providers: [
    AssistantService,
    PoolAssistantService,
    PoolSearch,
    PoolTools,
    DeepTools,
    SkillsService,
    LinkReviewService,
  ],
  exports: [AssistantService, PoolAssistantService, SkillsService],
})
export class AssistantModule {}
