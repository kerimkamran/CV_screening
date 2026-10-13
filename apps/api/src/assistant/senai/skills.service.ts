/**
 * The skills dictionary an administrator can extend (SenAI plan 5.1 F7, 13.2 C9).
 * A recruiter may suggest a word; an administrator approves it. Only approved entries are read.
 * A built-in skill is never changed. The reader in `@cv/shared` is rebuilt whenever a decision is made.
 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import {
  BASE_SKILLS,
  applyCustomSkills,
  fold,
  newId,
  skillsInTokens,
  tokens,
  type CustomSkill,
  type SkillKind,
} from '@cv/shared';
import { AuditService } from '../../audit/audit.service';
import type { Principal } from '../../auth/principal';
import { DbService } from '../../db/db.service';

export interface SkillEntry {
  id: string;
  skillId: string;
  label: string;
  kind: SkillKind;
  aliases: string[];
  extends: string | null;
  status: 'proposed' | 'approved' | 'rejected';
  proposedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  note: string | null;
  createdAt: string;
}

export interface SkillInput {
  label: string;
  kind: SkillKind;
  aliases: string[];
  /** A built-in skill id when these are only more ways to write it. */
  extends?: string | null;
}

const slug = (s: string) =>
  fold(s)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 38);

@Injectable()
export class SkillsService implements OnModuleInit {
  private readonly log = new Logger(SkillsService.name);
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reload();
    } catch (e) {
      // A fresh database may not have the table yet (migrations run first in a real start).
      this.log.warn(`skills dictionary not loaded: ${(e as Error).message}`);
    }
  }

  /** Reads the approved entries into the shared reader. */
  async reload(): Promise<number> {
    const { rows } = await this.db.query<{
      skillId: string;
      label: string;
      kind: SkillKind;
      aliases: string[];
      extendsSkill: string | null;
    }>(
      `SELECT skill_id AS "skillId", label, kind, aliases, extends_skill AS "extendsSkill"
         FROM assistant_skill WHERE status = 'approved' ORDER BY created_at, id`,
    );
    const custom: CustomSkill[] = rows.map((r) => ({
      id: r.skillId,
      label: r.label,
      kind: r.kind,
      aliases: r.aliases,
      extends: r.extendsSkill,
    }));
    applyCustomSkills(custom);
    return custom.length;
  }

  async list(status?: SkillEntry['status']): Promise<SkillEntry[]> {
    const { rows } = await this.db.query<SkillEntry>(
      `SELECT s.id, s.skill_id AS "skillId", s.label, s.kind, s.aliases, s.extends_skill AS extends,
              s.status, u.display_name AS "proposedBy", d.display_name AS "decidedBy",
              s.decided_at AS "decidedAt", s.note, s.created_at AS "createdAt"
         FROM assistant_skill s
         JOIN app_user u ON u.id = s.proposed_by
         LEFT JOIN app_user d ON d.id = s.decided_by
        WHERE ($1::text IS NULL OR s.status = $1)
        ORDER BY s.status = 'proposed' DESC, s.created_at DESC LIMIT 500`,
      [status ?? null],
    );
    return rows.map((r) => ({
      ...r,
      decidedAt: r.decidedAt ? new Date(r.decidedAt).toISOString() : null,
      createdAt: new Date(r.createdAt).toISOString(),
    }));
  }

  /** Checks an entry and returns it in the form that is stored. */
  private check(i: SkillInput): {
    skillId: string;
    label: string;
    aliases: string[];
    extends: string | null;
  } {
    const label = i.label.trim();
    if (!label) throw new BadRequestException('Give the skill a name');
    const ext = i.extends ?? null;
    if (ext && !BASE_SKILLS.some((s) => s.id === ext))
      throw new BadRequestException('That built-in skill does not exist');
    const aliases = [...new Set(i.aliases.map((a) => a.trim()).filter(Boolean))];
    if (ext === null && !aliases.some((a) => fold(a) === fold(label))) aliases.unshift(label);
    if (aliases.length === 0 || aliases.length > 20)
      throw new BadRequestException('Give between 1 and 20 ways the skill is written');
    for (const a of aliases) {
      const f = fold(a);
      if (f.length < 2 || f.length > 40)
        throw new BadRequestException(`"${a}" must be between 2 and 40 characters`);
      // A way of writing that SenAI already reads as another skill would make two skills collide.
      const hit = skillsInTokens(tokens(a)).find((h) => h.at.length === tokens(a).length);
      if (hit && hit.skill.id !== ext)
        throw new ConflictException(`"${a}" is already read as ${hit.skill.label}`);
    }
    const skillId = ext ?? slug(label);
    if (!/^[a-z0-9][a-z0-9-]{1,38}$/.test(skillId))
      throw new BadRequestException('The skill name needs at least two letters or digits');
    return { skillId, label, aliases, extends: ext };
  }

  /** A recruiter suggests (proposed); an administrator adds directly (approved). */
  async add(
    p: Principal,
    i: SkillInput,
    ip: string | undefined,
    approved: boolean,
  ): Promise<SkillEntry> {
    const c = this.check(i);
    const id = newId();
    try {
      await this.db.withTx(async (tx) => {
        await tx.query(
          `INSERT INTO assistant_skill
             (id, skill_id, label, kind, aliases, extends_skill, status, proposed_by, decided_by, decided_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            id,
            c.skillId,
            c.label,
            i.kind,
            c.aliases,
            c.extends,
            approved ? 'approved' : 'proposed',
            p.userId,
            approved ? p.userId : null,
            approved ? new Date() : null,
          ],
        );
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: approved ? 'assistant.skill_added' : 'assistant.skill_suggested',
          entityType: 'assistant_skill',
          entityId: id,
          after: { skill: c.skillId, label: c.label, aliases: c.aliases, extends: c.extends },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('A skill with this name is already in the dictionary');
      throw e;
    }
    if (approved) await this.reload();
    return (await this.list()).find((x) => x.id === id)!;
  }

  async decide(
    p: Principal,
    id: string,
    to: 'approved' | 'rejected',
    note: string | null,
    ip: string | undefined,
  ): Promise<SkillEntry> {
    const { rows } = await this.db.query<{ status: string }>(
      `SELECT status FROM assistant_skill WHERE id = $1`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException();
    if (rows[0].status === to) return (await this.list()).find((x) => x.id === id)!;
    try {
      await this.db.withTx(async (tx) => {
        await tx.query(
          `UPDATE assistant_skill SET status = $2, decided_by = $3, decided_at = now(), note = $4 WHERE id = $1`,
          [id, to, p.userId, note],
        );
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: to === 'approved' ? 'assistant.skill_approved' : 'assistant.skill_rejected',
          entityType: 'assistant_skill',
          entityId: id,
          before: { status: rows[0]!.status },
          after: { status: to },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('A skill with this name is already in the dictionary');
      throw e;
    }
    await this.reload();
    return (await this.list()).find((x) => x.id === id)!;
  }
}
