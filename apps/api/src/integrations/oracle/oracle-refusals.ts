import { HttpException } from '@nestjs/common';

/**
 * Stage 3 (plan 16.4): every refusal of the Oracle routes, with its one English sentence. The web
 * shows the sentence through its server-message dictionary (az.server.ts), so the English must
 * match the Wording table word for word.
 */
export const REFUSAL = {
  ORACLE_NOT_ACTIVE: {
    status: 409,
    message: 'The Oracle import is switched off. Tell an administrator.',
  },
  NOTICE_NOT_ATTESTED: {
    status: 409,
    message: 'An administrator has not yet confirmed that Oracle applicants are told about AI.',
  },
  RETENTION_OFF: {
    status: 409,
    message:
      'Automatic erasing of old CVs is off. An administrator must turn it on under Data retention before CVs can be imported.',
  },
  IMPORT_COOLDOWN: { status: 409, message: 'You can refresh again at {time}.' },
  ORACLE_AUTH: {
    status: 409,
    message: 'Sign-in to Oracle failed. Ask an administrator to check the Oracle connection.',
  },
  IMPORT_RUNNING: { status: 409, message: 'An import is already running for this vacancy.' },
  ORACLE_BUDGET: {
    status: 429,
    message: "Today's limit of calls to Oracle is used up. Try again tomorrow.",
  },
  AI_NOT_EU: {
    status: 409,
    message:
      'CVs from Oracle can be analyzed only by an AI model hosted in the EU. Ask an administrator to check AI models.',
  },
  ORACLE_UNAVAILABLE: {
    status: 503,
    message: 'Oracle is not answering. Try again in a few minutes.',
  },
  ORACLE_REQ_NOT_FOUND: {
    status: 404,
    message: 'No Oracle vacancy has this ID. Check the number and try again.',
  },
  ORACLE_REQ_LINKED: {
    status: 409,
    message: 'This Oracle vacancy is already linked to another vacancy here.',
  },
  LOOKUP_LIMIT: { status: 429, message: 'Too many lookups. Wait a minute and try again.' },
  LINK_NOT_APPROVED: { status: 409, message: 'The link must be approved by a team lead.' },
  TEST_LIMIT: { status: 429, message: 'You can test once every 5 minutes. Try again shortly.' },
} as const;
export type RefusalCode = keyof typeof REFUSAL;

export function refuse(
  code: RefusalCode,
  extra: Record<string, unknown> = {},
  fill: Record<string, string> = {},
) {
  const { status, message: text } = REFUSAL[code];
  const message = text.replace(/\{(\w+)\}/g, (m, k: string) => fill[k] ?? m);
  return new HttpException({ message, code, ...extra }, status);
}

/** A clock time in Baku (UTC+4) as HH:MM, for the `{time}` of the cooldown sentence. */
export const bakuTime = (d: Date) =>
  new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(11, 16);
