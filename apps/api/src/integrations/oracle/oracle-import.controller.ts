import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentPrincipal, Roles } from '../../auth/decorators';
import type { Principal } from '../../auth/principal';
import { parse, ulidSchema } from '../../common/validate';
import { OracleEnabledGuard } from './oracle-enabled.guard';
import { OracleImportService } from './oracle-import.service';

const refSchema = z.object({ ref: z.string().trim().min(1).max(64) });
const startSchema = z.object({
  ref: z.string().trim().min(1).max(64).optional(),
  estimate: z.number().int().min(0).max(100_000).optional(),
});

/**
 * Stage 3, S3-INT-10, S3-INT-11 and S3-INT-13: the recruiter's Oracle routes. The web asks
 * `GET vacancies/:id/oracle` once per page load; a 404 (switch off) or `available: false` hides the
 * feature and no other Oracle route is called.
 */
@Roles('TA_PARTNER', 'TA_LEAD')
@UseGuards(OracleEnabledGuard)
@Controller()
export class OracleImportController {
  constructor(private readonly svc: OracleImportService) {}

  @Get('vacancies/:id/oracle')
  state(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.state(p, parse(ulidSchema, id));
  }

  @Post('vacancies/:id/oracle/lookup')
  @HttpCode(200)
  lookup(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.lookup(p, parse(ulidSchema, id), parse(refSchema, body ?? {}).ref, req.ip);
  }

  @Post('vacancies/:id/oracle/imports')
  @HttpCode(202)
  start(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.startOrPropose(
      p,
      parse(ulidSchema, id),
      parse(startSchema, body ?? {}),
      req.ip,
    );
  }

  @Delete('vacancies/:id/oracle/link')
  unlink(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.unlink(p, parse(ulidSchema, id), req.ip);
  }

  /** Used only when lead approval is switched on (off by default). */
  @Roles('TA_LEAD')
  @Post('vacancies/:id/oracle/link/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.approve(p, parse(ulidSchema, id), req.ip);
  }

  @Post('import-runs/:id/confirm')
  @HttpCode(200)
  confirm(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.confirm(p, parse(ulidSchema, id), req.ip);
  }

  @Post('import-runs/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.cancel(p, parse(ulidSchema, id), req.ip);
  }
}
