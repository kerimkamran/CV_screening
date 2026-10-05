import { existsSync } from 'node:fs';
import multipart from '@fastify/multipart';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { CORRELATION_HEADER, LOG_REDACT_PATHS, requestId } from './common/correlation';
import { loadEnv } from './config/env';
import { AppModule } from './app.module';

export interface AdapterOptions {
  trustProxy?: boolean;
  maxUploadMb?: number;
}

export function createAdapter(logLevel: string, opts: AdapterOptions = {}): FastifyAdapter {
  const adapter = new FastifyAdapter({
    // Fastify's built-in pino logger: structured JSON, one line per request, correlation ID attached.
    logger: { level: logLevel, redact: LOG_REDACT_PATHS },
    genReqId: requestId,
    requestIdHeader: false,
    // True only when running behind a known reverse proxy (Render), so req.ip is the client's.
    trustProxy: opts.trustProxy ?? false,
    bodyLimit: 2 * 1024 * 1024,
  });
  void adapter.register(multipart as never, {
    limits: { fileSize: (opts.maxUploadMb ?? 10) * 1024 * 1024, files: 50, fields: 10 },
  });
  return adapter;
}

export async function createApp(): Promise<NestFastifyApplication> {
  const env = loadEnv();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createAdapter(env.LOG_LEVEL, {
      trustProxy: env.TRUST_PROXY === 'true',
      maxUploadMb: env.MAX_UPLOAD_MB,
    }),
    { bufferLogs: false },
  );
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (req, reply) => {
      // Echo the correlation ID so callers can quote it in support requests.
      reply.header(CORRELATION_HEADER, req.id);
      reply.header('x-content-type-options', 'nosniff');
      reply.header('x-frame-options', 'DENY');
      reply.header('referrer-policy', 'no-referrer');
      reply.header(
        'content-security-policy',
        "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'",
      );
      if (env.NODE_ENV === 'production') {
        reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
      }
      // Candidate data must never be cached by browsers or intermediaries.
      if (!req.url.startsWith('/assets/')) reply.header('cache-control', 'no-store');
    });
  // Single-service deploy: the API also serves the built web app (hash-routed, so no path clashes).
  if (env.WEB_DIST_DIR && existsSync(env.WEB_DIST_DIR)) {
    app.useStaticAssets({ root: env.WEB_DIST_DIR, prefix: '/', wildcard: false });
  }
  app.enableShutdownHooks();
  return app;
}
