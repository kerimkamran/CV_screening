import { Module, type OnModuleInit } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { eraseDocumentData } from '../pipeline/erase-document';
import { PipelineModule } from '../pipeline/pipeline.module';
import { ReportService } from '../pipeline/report.service';
import { VacancyModule } from '../vacancy/vacancy.module';
import { ImportRunnerService } from './import-runner.service';
import { ImportRunsAdminController } from './import-runs-admin.controller';
import { OracleAdminController } from './oracle/oracle-admin.controller';
import { OracleConnectionService } from './oracle/oracle-connection.service';
import { OracleEnabledGuard } from './oracle/oracle-enabled.guard';
import { OracleHcmClient } from './oracle/oracle-hcm.client';
import { OracleImportController } from './oracle/oracle-import.controller';
import { OracleImportService } from './oracle/oracle-import.service';
import { OracleSource } from './oracle/oracle-source';
import { PrincipalLoader } from './principal-loader';

/**
 * The start service under a string token, so the pipeline's Retry failed can find it at call time
 * (plan 15.3 note 12) without importing this module (PipelineModule never imports it back).
 */
export const ORACLE_IMPORT_START = 'ORACLE_IMPORT_START';

/**
 * Stage 3: the Oracle CV import. Imports PipelineModule (IntakeService, ProcessorService,
 * RetentionService); PipelineModule never imports this module back.
 */
@Module({
  imports: [PipelineModule, VacancyModule],
  controllers: [ImportRunsAdminController, OracleAdminController, OracleImportController],
  providers: [
    ImportRunnerService,
    PrincipalLoader,
    OracleEnabledGuard,
    OracleHcmClient,
    OracleConnectionService,
    OracleImportService,
    { provide: ORACLE_IMPORT_START, useExisting: OracleImportService },
  ],
  exports: [
    ImportRunnerService,
    PrincipalLoader,
    OracleHcmClient,
    OracleConnectionService,
    ORACLE_IMPORT_START,
  ],
})
export class IntegrationsModule implements OnModuleInit {
  constructor(
    private readonly runner: ImportRunnerService,
    private readonly conns: OracleConnectionService,
    private readonly reports: ReportService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    // The runner reads Oracle through this source; a spec may put another source in its place.
    this.runner.source ??= new OracleSource(this.conns);
    this.runner.eraser = async (tx, documentId, actorId) => {
      const done = await eraseDocumentData(tx, this.reports, documentId, actorId, 'source_removed');
      if (done)
        await this.audit.record(tx, {
          actorId,
          actorType: 'service',
          action: 'document.erase',
          entityType: 'document',
          entityId: documentId,
          after: {
            reason: 'source_removed',
            ...(done.tombstonePending ? { tombstonePending: 1 } : {}),
          },
        });
    };
  }
}
