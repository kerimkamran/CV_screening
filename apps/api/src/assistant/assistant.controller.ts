import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AnyAuthenticated, CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { INTENTS } from './assistant-rules';
import { AssistantService } from './assistant.service';

const askSchema = z.object({
  message: z.string().trim().max(1000).default(''),
  intent: z.enum(INTENTS).default('ask'),
  compareWith: z.array(ulidSchema).max(2).optional(),
  read: z.string().trim().max(400).optional(),
  language: z.enum(['en', 'az']).optional(),
});

/** Recruiter-facing assistant endpoints (design spec 6.6). Threads are private to the recruiter. */
@Roles('TA_PARTNER', 'TA_LEAD')
@Controller()
export class AssistantController {
  constructor(private readonly svc: AssistantService) {}

  /** What the screen needs to draw the panel: on or off, its name and which buttons exist. */
  @Get('assistant/config')
  @AnyAuthenticated()
  async config() {
    const s = await this.svc.settings();
    return {
      enabled: s.enabled,
      name: s.name,
      features: s.features,
      unavailableMessage: s.unavailableMessage,
    };
  }

  @Get('screenings/:id/assistant')
  thread(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.svc.thread(p, parse(ulidSchema, id));
  }

  @Post('screenings/:id/assistant')
  @HttpCode(200)
  ask(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    const b = parse(askSchema, body);
    if (b.intent === 'ask' && b.message.length === 0) {
      return this.svc.ask(p, parse(ulidSchema, id), { ...b, message: 'Why this band?', intent: 'why' }, req.ip);
    }
    return this.svc.ask(p, parse(ulidSchema, id), b, req.ip);
  }

  @Delete('screenings/:id/assistant')
  remove(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.deleteThread(p, parse(ulidSchema, id), req.ip);
  }
}
