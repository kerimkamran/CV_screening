import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AnyAuthenticated, CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { INTENTS } from './assistant-rules';
import { AssistantService } from './assistant.service';
import { detectLanguage } from './pool-assistant';
import { PoolAssistantService } from './pool-assistant.service';

const askSchema = z.object({
  message: z.string().trim().max(1000).default(''),
  intent: z.enum(INTENTS).default('ask'),
  compareWith: z.array(ulidSchema).max(2).optional(),
  read: z.string().trim().max(400).optional(),
  language: z.enum(['en', 'az', 'ru']).optional(),
});

/** Recruiter-facing assistant endpoints (design spec 6.6). Threads are private to the recruiter. */
@Roles('TA_PARTNER', 'TA_LEAD')
@Controller()
export class AssistantController {
  constructor(
    private readonly svc: AssistantService,
    private readonly poolSvc: PoolAssistantService,
  ) {}

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
    // The answer is written in the language the question is written in; a chip has fixed English
    // wording, so it follows the screen language.
    if (b.intent === 'ask') b.language = detectLanguage(b.message) ?? b.language;
    if (b.intent === 'ask' && b.message.length === 0) {
      return this.svc.ask(
        p,
        parse(ulidSchema, id),
        { ...b, message: 'Why this band?', intent: 'why' },
        req.ip,
      );
    }
    return this.svc.ask(p, parse(ulidSchema, id), b, req.ip);
  }

  @Delete('screenings/:id/assistant')
  remove(@Param('id') id: string, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    return this.svc.deleteThread(p, parse(ulidSchema, id), req.ip);
  }

  /** Ask SenAI across the pool: which vacancy, how many, who matches best (WP 4.3, 4.4). */
  @Post('assistant/ask')
  @HttpCode(200)
  poolAsk(@Body() body: unknown, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const b = parse(
      z.object({
        message: z.string().trim().max(1000).default(''),
        conversationId: ulidSchema.optional(),
        vacancyId: ulidSchema.optional(),
        pick: ulidSchema.optional(),
        showAll: z.boolean().optional(),
        language: z.enum(['en', 'az', 'ru']).optional(),
      }),
      body,
    );
    return this.poolSvc.ask(p, b, req.ip);
  }

  @Get('assistant/conversations')
  conversations(@CurrentPrincipal() p: Principal) {
    return this.poolSvc.list(p);
  }

  @Get('assistant/conversations/:id')
  conversation(@Param('id') id: string, @CurrentPrincipal() p: Principal) {
    return this.poolSvc.one(p, parse(ulidSchema, id));
  }

  @Delete('assistant/conversations/:id')
  removeConversation(
    @Param('id') id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.poolSvc.remove(p, parse(ulidSchema, id), req.ip);
  }
}
