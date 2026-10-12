import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { VacancyService, type ListQuery } from './vacancy.service';

const HUMAN = ['TA_PARTNER', 'TA_LEAD'] as const;

/** The Vacancy pool (design spec 6.7). Routes are thin; the rules live in VacancyService. */
@Controller('vacancies')
export class VacancyPoolController {
  constructor(private readonly svc: VacancyService) {}

  @Roles('TA_PARTNER', 'TA_LEAD', 'GOVERNANCE')
  @Get()
  list(@CurrentPrincipal() p: Principal, @Query() q: ListQuery) {
    return this.svc.list(p, q);
  }

  /** Before a new vacancy is created: is there one like it already? */
  @Roles(...HUMAN)
  @Get('similar')
  similar(@Query('title') title: string | undefined, @CurrentPrincipal() p: Principal) {
    return this.svc.similar(p, (title ?? '').slice(0, 200));
  }

  @Roles('TA_PARTNER', 'TA_LEAD', 'GOVERNANCE')
  @Get(':id')
  one(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.view(p, parse(ulidSchema, id));
  }

  /** A vacancy needs only a title; everything else is added on the Role card. */
  @Roles(...HUMAN)
  @Post()
  @HttpCode(201)
  create(@Body() body: unknown, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const b = parse(
      z.object({
        title: z.string().trim().min(2).max(200),
        department: z.string().trim().max(120).nullish(),
        location: z.string().trim().max(120).nullish(),
        employmentType: z.string().trim().max(60).nullish(),
        jdText: z.string().trim().max(20_000).optional(),
      }),
      body,
    );
    return this.svc.create(p, req.ip, b);
  }

  @Roles(...HUMAN)
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.update(p, parse(ulidSchema, id), req.ip, body);
  }

  @Roles(...HUMAN)
  @Post(':id/archive')
  @HttpCode(200)
  archive(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.archive(p, parse(ulidSchema, id), req.ip);
  }

  @Roles(...HUMAN)
  @Post(':id/restore')
  @HttpCode(200)
  restore(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.restore(p, parse(ulidSchema, id), req.ip);
  }

  @Roles(...HUMAN)
  @Post(':id/duplicate')
  @HttpCode(201)
  duplicate(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.duplicate(p, parse(ulidSchema, id), req.ip);
  }

  @Roles(...HUMAN)
  @Get(':id/history')
  history(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.history(p, parse(ulidSchema, id));
  }

  @Roles(...HUMAN)
  @Get(':id/runs')
  runs(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.runs(p, parse(ulidSchema, id));
  }

  @Roles(...HUMAN)
  @Post(':id/start')
  @HttpCode(200)
  start(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { confirmNotice } = parse(z.object({ confirmNotice: z.boolean().default(false) }), body);
    return this.svc.start(p, parse(ulidSchema, id), req.ip, confirmNotice);
  }

  @Roles(...HUMAN)
  @Post(':id/reread')
  @HttpCode(200)
  reread(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const { apply } = parse(z.object({ apply: z.boolean().default(false) }), body);
    return this.svc.reread(p, parse(ulidSchema, id), req.ip, apply);
  }
}
