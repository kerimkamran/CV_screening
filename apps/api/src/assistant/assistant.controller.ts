import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AnyAuthenticated, CurrentPrincipal, Roles } from '../auth/decorators';
import type { Principal } from '../auth/principal';
import { parse, ulidSchema } from '../common/validate';
import { INTENTS } from './assistant-rules';
import { AssistantService } from './assistant.service';
import { detectLanguage } from './pool-assistant';
import { PoolAssistantService } from './pool-assistant.service';
import { SkillsService } from './senai/skills.service';

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
    private readonly skills: SkillsService,
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

  /** A recruiter suggests a word SenAI does not know; an administrator decides (plan F7). */
  @Post('assistant/skills/suggest')
  @HttpCode(200)
  suggestSkill(
    @Body() body: unknown,
    @CurrentPrincipal() p: Principal,
    @Req() req: FastifyRequest,
  ) {
    return this.skills.add(
      p,
      parse(
        z.object({
          label: z.string().trim().min(1).max(60),
          kind: z.enum(['tool', 'language', 'domain', 'certificate']).default('tool'),
          aliases: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
          extends: z.string().trim().max(40).nullable().default(null),
        }),
        body,
      ),
      req.ip,
      false,
    );
  }

  /** The account menu's view of what SenAI keeps about the person (plan F6). */
  @Get('assistant/preferences')
  preferences(@CurrentPrincipal() p: Principal) {
    return this.poolSvc.preferences(p);
  }
  @Put('assistant/preferences')
  setPreferences(@Body() body: unknown, @CurrentPrincipal() p: Principal) {
    const b = parse(z.object({ top: z.number().int().min(1).max(50).nullable() }), body);
    return this.poolSvc.setPreferences(p, b.top);
  }

  /** "Analyze for this vacancy": a button on a rediscovery suggestion (switch). */
  @Post('assistant/rediscovery/analyze')
  @HttpCode(200)
  analyzeHere(@Body() body: unknown, @CurrentPrincipal() p: Principal, @Req() req: FastifyRequest) {
    const b = parse(z.object({ matchId: ulidSchema, vacancyId: ulidSchema }), body);
    return this.poolSvc.analyzeHere(p, b.matchId, b.vacancyId, req.ip);
  }

  /** Suggestions about a vacancy's wording and requirements, shown after a save (plan M6). */
  @Get('assistant/jd-coach/:vacancyId')
  coach(
    @Param('vacancyId') vacancyId: string,
    @Query('language') language: string | undefined,
    @CurrentPrincipal() p: Principal,
  ) {
    const lang = language === 'az' || language === 'ru' ? language : 'en';
    return this.poolSvc.coach(p, parse(ulidSchema, vacancyId), lang);
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
        /** A chip taken off the last answer: the same question again without that part. */
        without: z
          .object({
            kind: z.enum(['skill', 'band', 'mark', 'top']),
            text: z.string().max(60).optional(),
          })
          .optional(),
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
