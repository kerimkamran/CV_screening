/**
 * Consent record and reviewing a link the candidate gave (SenAI plan 5.4 S3, 7 `fetch_consented_link`,
 * 11.1 consent tiers). The rules, all enforced here:
 *  - the administrator's switch "link review" is on (default off);
 *  - a consent for this resume is recorded, with where it came from, and not withdrawn;
 *  - only a link that is written in the resume itself, and never a social network;
 *  - only on the recruiter's request (a button); the page is fetched by the server with the same
 *    guards as a vacancy link (no private addresses, robots.txt, size and time limits);
 *  - the text is redacted (name, contact details), shown as "candidate-provided link", never scored,
 *    never sent to a model, and deleted with the resume or when the consent is withdrawn.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { newId } from '@cv/shared';
import { AuditService } from '../../audit/audit.service';
import type { Principal } from '../../auth/principal';
import { DbService } from '../../db/db.service';
import { anonymise } from '../../pipeline/anonymise';
import { looksLikeInjection } from '../../pipeline/injection';
import { LinkProblem, LinkReader } from '../../pipeline/link-reader';
import { LINK_READER } from '../../pipeline/link-reader.token';
import { VacancyScope } from '../../vacancy/vacancy-scope.service';
import { AssistantService } from '../assistant.service';

export type ConsentSource = 'application_form' | 'hr_system' | 'email' | 'other';

/** Sites about a person's private life. Never read, even with consent (plan 5.5). */
const SOCIAL =
  /(^|\.)(linkedin|facebook|instagram|twitter|x|tiktok|telegram|t|vk|ok|snapchat|whatsapp|wa|threads|youtube|youtu)\.(com|me|be|ru|co)$/i;

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/gi;
const BARE_RE =
  /\b(?:github\.com|gitlab\.com|bitbucket\.org|behance\.net|dribbble\.com|kaggle\.com|medium\.com|credly\.com|coursera\.org|udemy\.com)\/[^\s<>"'`)\]}]+/gi;

/** The links written in a resume, first seen first, without those that may never be read. */
export function linksIn(text: string): { url: string; host: string; blocked: boolean }[] {
  const seen = new Set<string>();
  const out: { url: string; host: string; blocked: boolean }[] = [];
  const add = (raw: string) => {
    let u = raw.replace(/[.,;:!?]+$/, '');
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    let url: URL;
    try {
      url = new URL(u);
    } catch {
      return;
    }
    const key = `${url.hostname}${url.pathname}${url.search}`.toLowerCase();
    if (seen.has(key) || out.length >= 12) return;
    seen.add(key);
    out.push({ url: url.toString(), host: url.hostname, blocked: SOCIAL.test(url.hostname) });
  };
  // In the order they are written; a bare address inside a full one is the same link.
  const found = [...text.matchAll(URL_RE), ...text.matchAll(BARE_RE)].sort(
    (a, b) => a.index! - b.index!,
  );
  for (const m of found) add(m[0]);
  return out;
}

export interface LinkState {
  /** The administrator's switch. */
  enabled: boolean;
  consent: {
    id: string;
    source: ConsentSource;
    evidence: string;
    recordedBy: string | null;
    recordedAt: string;
  } | null;
  links: { url: string; host: string; blocked: boolean }[];
  reviews: {
    id: string;
    url: string;
    host: string;
    text: string;
    words: number;
    flagged: boolean;
    fetchedAt: string;
  }[];
}

@Injectable()
export class LinkReviewService {
  private readonly log = new Logger(LinkReviewService.name);
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly scope: VacancyScope,
    private readonly assistant: AssistantService,
    @Inject(LINK_READER) private readonly reader: LinkReader,
  ) {}

  private async doc(p: Principal, matchId: string) {
    const { rows } = await this.db.query<{
      documentId: string;
      vacancyId: string;
      text: string | null;
      name: string | null;
    }>(
      `SELECT d.id AS "documentId", d.vacancy_id AS "vacancyId", d.text, m.candidate_name AS name
         FROM screening m JOIN cv_document d ON d.id = m.document_id
        WHERE m.id = $1 AND d.erased_at IS NULL`,
      [matchId],
    );
    if (!rows[0]) throw new NotFoundException();
    await this.scope.assert(p, rows[0].vacancyId);
    return rows[0];
  }

  private async on(): Promise<boolean> {
    const s = await this.assistant.settings();
    return s.enabled && s.features.linkReview;
  }

  async state(p: Principal, matchId: string): Promise<LinkState> {
    const d = await this.doc(p, matchId);
    if (!(await this.on())) return { enabled: false, consent: null, links: [], reviews: [] };
    const c = await this.db.query<{
      id: string;
      source: ConsentSource;
      evidence: string;
      recordedBy: string | null;
      recordedAt: Date;
    }>(
      `SELECT c.id, c.source, c.evidence_ref AS evidence, u.display_name AS "recordedBy", c.recorded_at AS "recordedAt"
         FROM candidate_consent c LEFT JOIN app_user u ON u.id = c.recorded_by
        WHERE c.document_id = $1 AND c.scope = 'link_review' AND c.withdrawn_at IS NULL`,
      [d.documentId],
    );
    const rev = await this.db.query<LinkState['reviews'][number] & { fetchedAt: Date }>(
      `SELECT id, url, host, text, words, flagged, fetched_at AS "fetchedAt"
         FROM candidate_link_review WHERE document_id = $1 ORDER BY fetched_at DESC LIMIT 20`,
      [d.documentId],
    );
    return {
      enabled: true,
      consent: c.rows[0]
        ? { ...c.rows[0], recordedAt: new Date(c.rows[0].recordedAt).toISOString() }
        : null,
      links: linksIn(d.text ?? ''),
      reviews: rev.rows.map((r) => ({ ...r, fetchedAt: new Date(r.fetchedAt).toISOString() })),
    };
  }

  async record(
    p: Principal,
    matchId: string,
    source: ConsentSource,
    evidence: string,
    ip: string | undefined,
  ) {
    const d = await this.doc(p, matchId);
    if (!(await this.on())) throw new ForbiddenException('Reading candidate links is switched off');
    const id = newId();
    try {
      await this.db.withTx(async (tx) => {
        await tx.query(
          `INSERT INTO candidate_consent (id, document_id, scope, source, evidence_ref, recorded_by)
           VALUES ($1,$2,'link_review',$3,$4,$5)`,
          [id, d.documentId, source, evidence, p.userId],
        );
        await this.audit.record(tx, {
          actorId: p.userId,
          actorType: p.actorType,
          sourceIp: ip,
          action: 'consent.recorded',
          entityType: 'document',
          entityId: d.documentId,
          after: { scope: 'link_review', source, evidence },
        });
      });
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw new ConflictException('A consent is already recorded for this resume');
      throw e;
    }
    return this.state(p, matchId);
  }

  async withdraw(p: Principal, matchId: string, ip: string | undefined) {
    const d = await this.doc(p, matchId);
    await this.db.withTx(async (tx) => {
      const r = await tx.query(
        `UPDATE candidate_consent SET withdrawn_at = now(), withdrawn_by = $2
          WHERE document_id = $1 AND scope = 'link_review' AND withdrawn_at IS NULL`,
        [d.documentId, p.userId],
      );
      if (!r.rowCount) throw new NotFoundException();
      // What was read on the strength of the consent goes with it.
      const del = await tx.query(`DELETE FROM candidate_link_review WHERE document_id = $1`, [
        d.documentId,
      ]);
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'consent.withdrawn',
        entityType: 'document',
        entityId: d.documentId,
        after: { scope: 'link_review', reviewsDeleted: del.rowCount },
      });
    });
    return this.state(p, matchId);
  }

  async review(p: Principal, matchId: string, url: string, ip: string | undefined) {
    const d = await this.doc(p, matchId);
    if (!(await this.on())) throw new ForbiddenException('Reading candidate links is switched off');
    const consent = await this.db.query<{ id: string }>(
      `SELECT id FROM candidate_consent
        WHERE document_id = $1 AND scope = 'link_review' AND withdrawn_at IS NULL`,
      [d.documentId],
    );
    if (!consent.rows[0])
      throw new ForbiddenException(
        'No consent is recorded for this resume, so its links are not read',
      );
    // Only a link the resume itself contains: never an address someone typed in.
    const link = linksIn(d.text ?? '').find((l) => l.url === url);
    if (!link) throw new BadRequestException('That link is not in this resume');
    if (link.blocked)
      throw new BadRequestException('Social network pages are never read, with or without consent');
    let read;
    try {
      read = await this.reader.read(link.url);
    } catch (e) {
      if (!(e instanceof LinkProblem)) throw e;
      this.log.warn(`candidate link not read (${e.kind}): ${e.message}`);
      throw new BadRequestException({
        message: "Couldn't read that page. Open it yourself if you need it.",
        code: 'LINK_UNREADABLE',
      });
    }
    const clean = anonymise(read.text.slice(0, 6000), [d.name]).text.trim();
    // The page is untrusted: it is only shown, never obeyed. A page that talks to AI is marked.
    const flagged = looksLikeInjection(read.text);
    const id = newId();
    await this.db.withTx(async (tx) => {
      await tx.query(
        `INSERT INTO candidate_link_review
           (id, document_id, consent_id, url, host, text, words, flagged, requested_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          id,
          d.documentId,
          consent.rows[0]!.id,
          link.url,
          read.host,
          clean,
          clean.split(/\s+/).filter(Boolean).length,
          flagged,
          p.userId,
        ],
      );
      await this.audit.record(tx, {
        actorId: p.userId,
        actorType: p.actorType,
        sourceIp: ip,
        action: 'candidate_link.reviewed',
        entityType: 'document',
        entityId: d.documentId,
        after: { host: read.host, words: read.words, flagged },
      });
    });
    return this.state(p, matchId);
  }
}
