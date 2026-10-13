import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { LinkReviewService } from './senai/link-review.service';

/** Candidate-provided links (plan S3): off unless the administrator turns on "link review". */
@Roles('TA_PARTNER', 'TA_LEAD')
@Controller('assistant/candidates/:matchId/links')
export class LinkReviewController {
  constructor(private readonly svc: LinkReviewService) {}

  @Get()
  state(@Param('matchId') id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.state(p, parse(ulidSchema, id));
  }

  @Post('consent')
  @HttpCode(200)
  consent(
    @Param('matchId') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(
      z.object({
        source: z.enum(['application_form', 'hr_system', 'email', 'other']),
        evidence: z.string().trim().min(3).max(200),
      }),
      body,
    );
    return this.svc.record(p, parse(ulidSchema, id), b.source, b.evidence, req.ip);
  }

  @Delete('consent')
  withdraw(
    @Param('matchId') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.withdraw(p, parse(ulidSchema, id), req.ip);
  }

  @Post('review')
  @HttpCode(200)
  review(
    @Param('matchId') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(z.object({ url: z.string().trim().min(8).max(2000) }), body);
    return this.svc.review(p, parse(ulidSchema, id), b.url, req.ip);
  }
}
