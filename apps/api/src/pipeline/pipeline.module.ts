import { Module } from '@nestjs/common';
import { VacancyModule } from '../vacancy/vacancy.module';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentService } from './adjustments.service';
import { CriteriaController } from './criteria.controller';
import { DocumentsController } from './documents.controller';
import { ExportService } from './export.service';
import { ProcessorService } from './processor.service';
import { ScreeningsController } from './screenings.controller';

@Module({
  imports: [VacancyModule],
  controllers: [
    CriteriaController,
    DocumentsController,
    ScreeningsController,
    AdjustmentsController,
  ],
  providers: [ProcessorService, ExportService, AdjustmentService],
  exports: [ProcessorService, AdjustmentService],
})
export class PipelineModule {}
