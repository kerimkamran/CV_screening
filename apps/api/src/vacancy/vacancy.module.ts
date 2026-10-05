import { Module } from '@nestjs/common';
import { VacancyController } from './vacancy.controller';
import { VacancyScope } from './vacancy-scope.service';

@Module({
  controllers: [VacancyController],
  providers: [VacancyScope],
  exports: [VacancyScope],
})
export class VacancyModule {}
