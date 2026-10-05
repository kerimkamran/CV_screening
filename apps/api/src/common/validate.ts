import { BadRequestException } from '@nestjs/common';
import { isUlid } from '@cv/shared';
import { z } from 'zod';

/** Validates untrusted input; reports field names only, never echoing values. */
export function parse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const fields = [...new Set(r.error.issues.map((i) => i.path.join('.') || '(body)'))];
    throw new BadRequestException({ message: 'Invalid request', fields });
  }
  return r.data;
}

export const ulidSchema = z.string().refine(isUlid, 'must be a ULID');
