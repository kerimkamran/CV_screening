import { Injectable } from '@nestjs/common';
import { newId } from '@cv/shared';
import type { Queryable } from '../db/db.service';

export interface AuditInput {
  actorId: string;
  actorType: 'human' | 'service';
  actorRole?: string;
  sourceIp?: string;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

/**
 * IAM-05. Appends to the hash-chained audit_event table. Pass the transaction client so the
 * audit row commits atomically with the change it describes; the database rejects the write if
 * the principal is missing.
 */
@Injectable()
export class AuditService {
  async record(q: Queryable, e: AuditInput): Promise<void> {
    await q.query(
      `INSERT INTO audit_event
         (id, actor_id, actor_type, actor_role, source_ip, action, entity_type, entity_id, before, after)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        newId(),
        e.actorId,
        e.actorType,
        e.actorRole ?? null,
        e.sourceIp ?? null,
        e.action,
        e.entityType,
        e.entityId,
        e.before === undefined ? null : JSON.stringify(e.before),
        e.after === undefined ? null : JSON.stringify(e.after),
      ],
    );
  }
}
