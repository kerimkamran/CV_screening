import { Module } from '@nestjs/common';
import { VacancyModule } from '../vacancy/vacancy.module';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentService } from './adjustments.service';
import { CandidatesService } from './candidates.service';
import { CriteriaController } from './criteria.controller';
import { DocumentsController } from './documents.controller';
import { ExportService } from './export.service';
import { ProcessorService } from './processor.service';
import { ReportService } from './report.service';
import { ReportsController } from './reports.controller';
import { ScreeningsController } from './screenings.controller';

@Module({
  imports: [VacancyModule],
  controllers: [
    CriteriaController,
    DocumentsController,
    ScreeningsController,
    AdjustmentsController,
    ReportsController,
  ],
  providers: [ProcessorService, ExportService, AdjustmentService, CandidatesService, ReportService],
  exports: [ProcessorService, AdjustmentService, CandidatesService, ReportService],
})
export class PipelineModule {}
