import { Module } from '@nestjs/common';
import { VacancyModule } from '../vacancy/vacancy.module';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentService } from './adjustments.service';
import { CandidatePoolController } from './candidate-pool.controller';
import { CandidateViewService } from './candidate-view.service';
import { CandidatesService } from './candidates.service';
import { CriteriaController } from './criteria.controller';
import { CriteriaSets } from './criteria-sets';
import { DocumentsController } from './documents.controller';
import { ExportService } from './export.service';
import { ProcessorService } from './processor.service';
import { ReportService } from './report.service';
import { RetentionController } from './retention.controller';
import { RetentionService } from './retention.service';
import { ReportsController } from './reports.controller';
import { ScreeningsController } from './screenings.controller';
import { LINK_READER } from './link-reader.token';
import { LinkReader } from './link-reader';
import { PoolService } from './pool.service';
import { VacancyPoolController } from './vacancy-pool.controller';
import { VacancyService } from './vacancy.service';

@Module({
  imports: [VacancyModule],
  controllers: [
    VacancyPoolController,
    CandidatePoolController,
    CriteriaController,
    DocumentsController,
    ScreeningsController,
    AdjustmentsController,
    ReportsController,
    RetentionController,
  ],
  providers: [
    { provide: LINK_READER, useFactory: () => new LinkReader() },
    VacancyService,
    PoolService,
    CandidateViewService,
    CriteriaSets,
    ProcessorService,
    ExportService,
    AdjustmentService,
    CandidatesService,
    ReportService,
    RetentionService,
  ],
  exports: [
    VacancyService,
    PoolService,
    CriteriaSets,
    ProcessorService,
    AdjustmentService,
    CandidatesService,
    ReportService,
    RetentionService,
  ],
})
export class PipelineModule {}
