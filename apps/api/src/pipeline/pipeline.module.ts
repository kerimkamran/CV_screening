import { Module } from '@nestjs/common';
import { VacancyModule } from '../vacancy/vacancy.module';
import { CriteriaController } from './criteria.controller';
import { DocumentsController } from './documents.controller';
import { ExportService } from './export.service';
import { ProcessorService } from './processor.service';
import { ScreeningsController } from './screenings.controller';

@Module({
  imports: [VacancyModule],
  controllers: [CriteriaController, DocumentsController, ScreeningsController],
  providers: [ProcessorService, ExportService],
  exports: [ProcessorService],
})
export class PipelineModule {}
