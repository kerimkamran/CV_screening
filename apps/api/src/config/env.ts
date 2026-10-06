import { z } from 'zod';

/**
 * Runtime configuration, validated once at boot (PLAT-05). Secrets are never defaulted here:
 * a missing DATABASE_URL in production is a startup failure, not a silent fallback.
 *
 * AISEC-01: there is deliberately no model-provider key in this schema. Provider keys are entered
 * by an ADMIN, stored encrypted in the database (ADR 0010), used only server-side, and never
 * returned by any endpoint or placed in anything a browser bundle can reach.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().url(),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  /**
   * IAM-01: corporate IdP via OIDC. All three are required: an API with no way to verify
   * tokens must not start, rather than start open. JWKS URI is explicit so boot never depends
   * on a discovery call.
   */
  AUTH_MODE: z.enum(['oidc', 'local']).default('oidc'),
  OIDC_ISSUER: z.string().url().optional(),
  OIDC_AUDIENCE: z.string().min(1).optional(),
  OIDC_JWKS_URI: z.string().url().optional(),
  /** AUTH_MODE=local: secret signing session tokens (HS256). Generate with `openssl rand -base64 48`. */
  SESSION_SECRET: z.string().min(32).optional(),
  LOCAL_SESSION_SECONDS: z.coerce.number().int().min(300).max(28_800).default(3_600),
  /** AUTH_MODE=local: first ADMIN, created at boot only while no active ADMIN exists; must change password at first sign-in. */
  BOOTSTRAP_ADMIN_EMAIL: z.string().email().optional(),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).optional(),
  /** Public URL of the app, used in the sign-in link emailed to new users. */
  APP_BASE_URL: z.string().url().optional(),
  /** Set when running behind a reverse proxy (Render): trust X-Forwarded-* for client IP. */
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  /**
   * AI provider keys are NOT environment variables: an ADMIN enters them in the app and they are
   * stored AES-256-GCM encrypted. This is the master key for that encryption: 32 bytes base64, or any secret of 32+ characters (hashed).
   */
  SETTINGS_ENCRYPTION_KEY: z.string().optional(),
  /** Directory holding the built web app; served by the API when set (single-service deploy). */
  WEB_DIST_DIR: z.string().optional(),
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'resend']).default('console'),
  EMAIL_FROM: z.string().default('Azerconnect CV Screening <no-reply@example.invalid>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  SMTP_SECURE: z.enum(['true', 'false']).default('false'),
  RESEND_API_KEY: z.string().optional(),
  /** In-process screening worker (MVP). Set false to run API-only. */
  WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  /** Upload limits (MVP, in-process). */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(50).default(10),
  /** A ZIP of resumes (spec 6.1.4): the archive itself, and the most resumes one run may hold. */
  MAX_ZIP_MB: z.coerce.number().int().min(1).max(500).default(100),
  MAX_RESUMES_PER_RUN: z.coerce.number().int().min(1).max(5000).default(500),
  /**
   * IAM-06: bounded session lifetime. Tokens whose own lifetime (exp - iat) exceeds this are
   * refused, so a misconfigured IdP cannot mint effectively-permanent credentials. Idle timeout
   * is enforced by the IdP session policy and the front end, not here.
   */
  MAX_TOKEN_LIFETIME_SECONDS: z.coerce.number().int().min(60).max(86_400).default(5_400),
  /**
   * Chicken-and-egg for the first ADMIN: the IdP subject named here is granted ADMIN on first
   * sign-in, but ONLY while no active ADMIN exists. Unset it once an admin is in place.
   */
  BOOTSTRAP_ADMIN_SUBJECT: z.string().min(1).optional(),
  /** PLAT-07: readiness fails if the database does not answer within this budget. */
  READINESS_TIMEOUT_MS: z.coerce.number().int().min(100).max(30_000).default(2_000),
});

const Refined = EnvSchema.superRefine((e, ctx) => {
  const need = (cond: unknown, path: string, msg: string) => {
    if (!cond) ctx.addIssue({ code: 'custom', path: [path], message: msg });
  };
  if (e.AUTH_MODE === 'oidc') {
    need(e.OIDC_ISSUER, 'OIDC_ISSUER', 'required when AUTH_MODE=oidc');
    need(e.OIDC_AUDIENCE, 'OIDC_AUDIENCE', 'required when AUTH_MODE=oidc');
    need(e.OIDC_JWKS_URI, 'OIDC_JWKS_URI', 'required when AUTH_MODE=oidc');
  } else {
    need(e.SESSION_SECRET, 'SESSION_SECRET', 'required when AUTH_MODE=local');
  }
  if (e.SETTINGS_ENCRYPTION_KEY !== undefined) {
    need(
      e.SETTINGS_ENCRYPTION_KEY.trim().length >= 32,
      'SETTINGS_ENCRYPTION_KEY',
      'must be at least 32 characters (a 32-byte base64 value is used as is; any other secret is hashed to 256 bits)',
    );
  }
  if (e.EMAIL_PROVIDER === 'smtp') need(e.SMTP_HOST, 'SMTP_HOST', 'required for smtp');
  if (e.EMAIL_PROVIDER === 'resend')
    need(e.RESEND_API_KEY, 'RESEND_API_KEY', 'required for resend');
  if (e.NODE_ENV === 'production' && e.AUTH_MODE === 'local') {
    need(e.APP_BASE_URL, 'APP_BASE_URL', 'required in production');
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = Refined.safeParse(source);
  if (!parsed.success) {
    // Report variable names only; never echo values (they may be credentials).
    const names = [...new Set(parsed.error.issues.map((i) => i.path.join('.')))].join(', ');
    throw new Error(`Invalid environment configuration: ${names}`);
  }
  return parsed.data;
}

export const ENV = Symbol('ENV');
