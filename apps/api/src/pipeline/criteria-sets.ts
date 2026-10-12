import { Injectable } from '@nestjs/common';
import { newId } from '@cv/shared';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import type { requirementInput } from './schemas';

export type ReqInput = z.infer<typeof requirementInput>;

export interface SetRef {
  id: string;
  version: number;
  frozen: boolean;
}

export interface StoredRequirement {
  id: string;
  text: string;
  classification: string;
  weight: number | null;
  rule: unknown;
  confidence: string | null;
}

/**
 * Requirement sets (JOB-07) and the requirements version that goes with them (Development Plan,
 * UAT round 1, WP 1.2). One place for the draft-set rules so the criteria screen, the Role card
 * and the extraction all behave the same way.
 */
@Injectable()
export class CriteriaSets {
  async latest(tx: PoolClient, vid: string): Promise<SetRef | undefined> {
    const r = await tx.query<SetRef>(
      `SELECT id, version, frozen_at IS NOT NULL AS frozen FROM requirement_set
        WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1 FOR UPDATE`,
      [vid],
    );
    return r.rows[0];
  }

  async hasFrozen(tx: PoolClient, vid: string): Promise<boolean> {
    const r = await tx.query(
      `SELECT 1 FROM requirement_set WHERE vacancy_id = $1 AND frozen_at IS NOT NULL LIMIT 1`,
      [vid],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async requirements(tx: PoolClient, setId: string): Promise<StoredRequirement[]> {
    const r = await tx.query<StoredRequirement>(
      `SELECT id, text, classification, weight::float AS weight, rule, extraction_conf AS confidence
         FROM requirement WHERE requirement_set_id = $1 ORDER BY position, id`,
      [setId],
    );
    return r.rows;
  }

  /** The editable set: reuse the open draft, or open the next version. */
  async draftSet(
    tx: PoolClient,
    vid: string,
    userId: string,
    jdVersionId: string,
    reuse: boolean,
  ): Promise<string> {
    await tx.query(`SELECT 1 FROM vacancy WHERE id = $1 FOR UPDATE`, [vid]);
    const latest = await this.latest(tx, vid);
    if (latest && !latest.frozen && reuse) {
      await tx.query(`UPDATE requirement_set SET jd_version_id = $2 WHERE id = $1`, [
        latest.id,
        jdVersionId,
      ]);
      return latest.id;
    }
    const id = newId();
    await tx.query(
      `INSERT INTO requirement_set (id, vacancy_id, version, jd_version_id, created_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, vid, (latest?.version ?? 0) + 1, jdVersionId, userId],
    );
    return id;
  }

  async replaceRequirements(tx: PoolClient, setId: string, reqs: ReqInput[]) {
    await tx.query(`DELETE FROM requirement WHERE requirement_set_id = $1`, [setId]);
    for (const [i, r] of reqs.entries()) {
      await tx.query(
        `INSERT INTO requirement (id, requirement_set_id, text, classification, weight, extraction_conf, rule, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId(),
          setId,
          r.text,
          r.classification,
          r.classification === 'mandatory' || r.classification === 'preferred'
            ? (r.weight ?? (r.classification === 'mandatory' ? 10 : 5))
            : null,
          r.confidence ?? null,
          r.rule ? JSON.stringify(r.rule) : null,
          i,
        ],
      );
    }
  }

  async copyRequirements(tx: PoolClient, from: string, to: string) {
    const { rows } = await tx.query<{
      text: string;
      classification: string;
      weight: string | null;
      extraction_conf: string | null;
      rule: unknown;
      position: number;
    }>(
      `SELECT text, classification, weight, extraction_conf, rule, position FROM requirement WHERE requirement_set_id = $1`,
      [from],
    );
    for (const r of rows) {
      await tx.query(
        `INSERT INTO requirement (id, requirement_set_id, text, classification, weight, extraction_conf, rule, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          newId(),
          to,
          r.text,
          r.classification,
          r.weight,
          r.extraction_conf,
          r.rule ? JSON.stringify(r.rule) : null,
          r.position,
        ],
      );
    }
  }

  /** The newest job-description version id for a vacancy. */
  async latestJd(tx: PoolClient, vid: string) {
    const r = await tx.query<{ id: string; body: string; version: number }>(
      `SELECT id, body, version FROM job_description_version WHERE vacancy_id = $1 ORDER BY version DESC LIMIT 1`,
      [vid],
    );
    return r.rows[0];
  }

  /** Describe how a requirement list changed, for the history ("added", "removed", "must-have to nice-to-have"). */
  diff(
    before: { text: string; classification: string }[],
    after: { text: string; classification: string }[],
  ) {
    const key = (t: string) => t.trim().toLowerCase();
    const kind = (c: string) =>
      c === 'mandatory' ? 'must-have' : c === 'preferred' ? 'nice-to-have' : c;
    const b = new Map(before.map((r) => [key(r.text), r]));
    const a = new Map(after.map((r) => [key(r.text), r]));
    const out: { field: string; requirement: string; from: string | null; to: string | null }[] =
      [];
    for (const [k, r] of a) {
      const old = b.get(k);
      if (!old)
        out.push({
          field: 'requirement',
          requirement: r.text,
          from: null,
          to: kind(r.classification),
        });
      else if (old.classification !== r.classification)
        out.push({
          field: 'requirement',
          requirement: r.text,
          from: kind(old.classification),
          to: kind(r.classification),
        });
    }
    for (const [k, r] of b)
      if (!a.has(k))
        out.push({
          field: 'requirement',
          requirement: r.text,
          from: kind(r.classification),
          to: null,
        });
    return out;
  }

  /**
   * Raise the vacancy's requirements version and write the history row (spec 6.7, "Changing
   * requirements after analysis"). Before anything has been analyzed there is nothing to go out
   * of date, so the number only moves once a frozen set exists.
   */
  async bump(
    tx: PoolClient,
    vid: string,
    userId: string,
    cause: 'create' | 'edit' | 'reread' | 'restore',
    changes: unknown[],
    description: string | null,
    linkUrl: string | null,
  ): Promise<number> {
    const frozen = await this.hasFrozen(tx, vid);
    const r = await tx.query<{ v: number }>(
      frozen
        ? `UPDATE vacancy SET requirements_version = requirements_version + 1 WHERE id = $1 RETURNING requirements_version AS v`
        : `SELECT requirements_version AS v FROM vacancy WHERE id = $1`,
      [vid],
    );
    const v = r.rows[0]!.v;
    if (frozen || cause === 'create') {
      await tx.query(
        `INSERT INTO vacancy_history (id, vacancy_id, requirements_version, changed_by, cause, changes, description, link_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [newId(), vid, v, userId, cause, JSON.stringify(changes), description, linkUrl],
      );
    }
    return v;
  }
}
