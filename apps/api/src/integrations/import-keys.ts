import { createHmac } from 'node:crypto';

/**
 * Stage 3, S3-INT-02 (plan 15.3 notes 9 and 10): versioned HMAC keys for the Oracle import.
 * Hashes stand in for raw Oracle IDs once a run ends, and tombstones hold hashes only, so an erased
 * candidate can be recognised on a later Refresh without keeping who they were.
 *
 * `IMPORT_TOMBSTONE_KEY` is either a bare value (version 1, as Render generates it) or a list
 * `2:<new>,1:<old>`. New hashes use the first key; matching tries every listed key.
 */
export interface ImportKey {
  version: number;
  secret: string;
}

export type KeyKind = 'application' | 'attachment' | 'person_requisition';

export function parseImportKeys(raw: string | undefined): ImportKey[] {
  if (!raw || !raw.trim()) return [];
  const keys = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^(\d+):(.+)$/s.exec(part);
      return m ? { version: Number(m[1]), secret: m[2]! } : { version: 1, secret: part };
    });
  const seen = new Set<number>();
  for (const k of keys) {
    if (!Number.isInteger(k.version) || k.version < 1)
      throw new Error('IMPORT_TOMBSTONE_KEY: bad version');
    if (seen.has(k.version)) throw new Error('IMPORT_TOMBSTONE_KEY: repeated version');
    seen.add(k.version);
  }
  return keys;
}

/** One hash: kind-separated, so an application ID can never collide with an attachment ID. */
export function keyHash(key: ImportKey, kind: KeyKind, ...parts: string[]): string {
  const h = createHmac('sha256', key.secret);
  h.update(`parallax-import:v1:${kind}`);
  for (const p of parts) {
    h.update('\u0000');
    h.update(p);
  }
  return h.digest('hex');
}

export class ImportKeys {
  constructor(private readonly keys: ImportKey[]) {}

  static from(raw: string | undefined): ImportKeys {
    return new ImportKeys(parseImportKeys(raw));
  }

  get available(): boolean {
    return this.keys.length > 0;
  }

  /** The key new hashes are written with. Throws when no key is set (the env rule requires one when the switch is on). */
  get current(): ImportKey {
    const k = this.keys[0];
    if (!k) throw new Error('IMPORT_TOMBSTONE_KEY is not set');
    return k;
  }

  /** The three hashes of one application with a CV, under the current key. */
  forItem(
    system: string,
    ids: { applicationId: string; attachmentId: string; personId: string; requisitionId: string },
  ) {
    const k = this.current;
    return {
      keyVersion: k.version,
      app: keyHash(k, 'application', system, ids.applicationId),
      att: keyHash(k, 'attachment', system, ids.attachmentId),
      person: keyHash(k, 'person_requisition', system, ids.personId, ids.requisitionId),
    };
  }

  /** Every hash an application or a person-and-requisition pair may have been stored under. */
  candidates(
    system: string,
    ids: { applicationId: string; personId: string; requisitionId: string },
  ) {
    return this.keys.flatMap((k) => [
      keyHash(k, 'application', system, ids.applicationId),
      keyHash(k, 'person_requisition', system, ids.personId, ids.requisitionId),
    ]);
  }

  /** Hashes of an attachment under every key (a newer file on an imported application). */
  attachmentCandidates(system: string, attachmentId: string): string[] {
    return this.keys.map((k) => keyHash(k, 'attachment', system, attachmentId));
  }

  applicationCandidates(system: string, applicationId: string): string[] {
    return this.keys.map((k) => keyHash(k, 'application', system, applicationId));
  }
}
