/**
 * Avvia Nest e collega gli adapter. In esercizio usa sempre PostgreSQL:
 * nessun fallback silenzioso in memoria quando il database non è disponibile.
 * createServer è esportata per verificare la stessa pipeline HTTP nei test.
 */
import 'reflect-metadata';
import 'dotenv/config';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/contracts';
import { Application } from './application';
import { AppController } from './app.controller';
import { PostgresStorageFactory } from '../infrastructure/persistence';
import { createInvitationNotifier, createPasswordResetSender } from '../infrastructure/password-reset-mail';
import { createJsonLogger } from '../infrastructure/json-logger';
import type { Logger } from '../shared/logger';

const authRequestLimits = new Map([
  ['/api/auth/login', 30],
  ['/api/auth/register', 12],
  ['/api/auth/forgot-password', 8],
  ['/api/auth/reset-password', 20],
  // Limita anche i tentativi di scoprire email di pazienti tramite gli inviti.
  ['/api/patients/invitations', 20],
  // Conferma password per eliminare l'account: stessi limiti del login.
  ['/api/account/delete', 10],
  ['/api/account/password', 10],
]);

/**
 * Database irraggiungibile, pool esaurito, transazione o lock scaduti: guasti
 * temporanei dell'infrastruttura, distinti da un bug. Codici Prisma P1001/P1002/
 * P1008/P1017 (connessione), P2024 (pool), P2028 (transazione), 55P03 (lock_timeout).
 */
export function isStorageUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code, meta } = error as { name?: string; code?: string; meta?: { code?: string } };
  if (name === 'PrismaClientInitializationError' || name === 'PrismaClientRustPanicError') return true;
  if (typeof code === 'string' && ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028'].includes(code)) return true;
  return code === 'P2010' && meta?.code === '55P03';
}

function errorKind(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const name = error.name;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && /^P\d{4}$/.test(code)) return code;
  if (typeof code === 'string' && ['EADDRINUSE', 'EACCES', 'ECONNREFUSED', 'ERR_INVALID_URL'].includes(code)) return code;
  return ['PrismaClientInitializationError', 'PrismaClientRustPanicError', 'TypeError', 'RangeError'].includes(name) ? name : 'Error';
}

@Catch()
class ErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const requestId = res.locals.requestId as string | undefined;
    if (error instanceof AppError) { res.locals.errorCode = error.code; return res.status(error.status).json({ code: error.code, message: error.message }); }
    if (error instanceof HttpException) { res.locals.errorCode = 'HttpError'; return res.status(error.getStatus()).json({ code: 'HttpError', message: error.message }); }
    if (isStorageUnavailable(error)) {
      // Guasto gestito: il client ritenta (la coda offline conserva le registrazioni).
      res.locals.errorCode = 'ServiceUnavailable';
      this.logger.log('error', 'storage.unavailable', { requestId, error: errorKind(error) });
      return res.status(503).setHeader('Retry-After', '5').json({ code: 'ServiceUnavailable', message: 'Servizio temporaneamente non disponibile. Le registrazioni vengono riprovate automaticamente.' });
    }
    res.locals.errorCode = 'InternalError';
    this.logger.log('error', 'request.unhandled_error', { requestId, error: errorKind(error) });
    return res.status(500).json({ code: 'InternalError', message: 'Operazione non completata. Riprovare.' });
  }
}

/** Legge il pattern registrato da Express, senza mai rileggere parametri o query. */
function routeTemplate(req: Request): string {
  const template: unknown = req.route?.path;
  return typeof template === 'string' && template.startsWith('/api/')
    ? template.replace(/:[A-Za-z][A-Za-z0-9_]*/g, ':id')
    : '/api/(unmatched)';
}
export async function createServer(application: Application, quiet = false) {
  @Module({ controllers: [AppController], providers: [{ provide: Application, useValue: application }] })
  class ApiModule {}
  const server = await NestFactory.create(ApiModule, { logger: false, abortOnError: false });
  const logger = application.logger;
  server.useGlobalFilters(new ErrorFilter(logger));
  // Correlazione: ogni richiesta ha un ID, restituito al client e presente in tutti i suoi log.
  server.use((req: Request, res: Response, next: NextFunction) => {
    const incoming = req.headers['x-request-id'];
    const requestId = typeof incoming === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(incoming)
      ? incoming : randomUUID();
    res.locals.requestId = requestId;
    res.setHeader('X-Request-Id', requestId);
    const started = process.hrtime.bigint();
    res.on('finish', () => {
      if (!/^\/api(?:\/|$)/i.test(req.path)) return;
      const status = res.statusCode;
      const route = routeTemplate(req);
      logger.log(status >= 500 ? 'error' : route.startsWith('/api/health/') ? 'debug' : 'info', 'http.request', {
        requestId, method: req.method, route, status,
        durationMs: Math.round(Number(process.hrtime.bigint() - started) / 1e5) / 10, code: res.locals.errorCode,
      });
    });
    next();
  });
  const authRequests = new Map<string, { count: number; start: number }>();
  server.use((req: Request, res: Response, next: NextFunction) => {
    const path = req.path.toLowerCase().replace(/\/+$/, '');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    if (path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
      // Browser same-origin: evita login CSRF. Nessun CORS indiscriminato.
      try { if (new URL(origin).host !== req.headers.host) throw new Error(); }
      catch { return res.status(403).json({ code: 'OriginError', message: 'Origine non consentita.' }); }
    }
    const limit = req.method === 'POST' || req.method === 'PATCH' ? authRequestLimits.get(path) : undefined;
    if (limit !== undefined) {
      const now = Date.now(), key = `${path}:${req.ip ?? 'local'}`;
      if (authRequests.size > 10000) authRequests.clear();
      const item = authRequests.get(key);
      const bucket = item && now - item.start < 60000 ? item : { count: 0, start: now };
      authRequests.set(key, bucket); bucket.count++;
      if (bucket.count > limit) {
        res.locals.errorCode = 'RateLimit';
        return res.status(429).json({ code: 'RateLimit', message: 'Troppi tentativi. Attendere un minuto.' });
      }
    }
    next();
  });
  // L'upload usa base64: aumenta il limite JSON solo per questa rotta.
  const photoJson = express.json({ limit: '3mb', inflate: false });
  server.use('/api/progress/photos', (req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'POST' || req.path !== '/') return next();
    return photoJson(req, res, (error?: { status?: number }) => {
      if (!error) return next();
      if (error.status === 413) return res.status(413).json({ code: 'PhotoTooLarge', message: 'La foto deve pesare al massimo 2 MiB.' });
      return res.status(error.status === 415 ? 415 : 400).json({ code: 'InvalidPhoto', message: 'Richiesta di caricamento non valida.' });
    });
  });
  const web = resolve(__dirname, '../../../web/dist');
  // src/composition e dist/composition hanno la stessa profondità dal workspace.
  const webRoot = existsSync(web) ? web : resolve(process.cwd(), '../web/dist');
  if (existsSync(webRoot)) server.use(express.static(webRoot, { setHeaders: (res, path) => {
    if (path.endsWith('sw.js') || path.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
  } }));
  await server.init();
  return server;
}

async function main(logger: Logger) {
  const storage = new PostgresStorageFactory();
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    const application = new Application(storage, Date.now, createPasswordResetSender(process.env), createInvitationNotifier(process.env), logger);
    await storage.ping();
    const listeningServer = await createServer(application);
    server = listeningServer;
    const port = Number(process.env.PORT ?? 3000);
    await listeningServer.listen(port, '127.0.0.1');
    const dispatcher = setInterval(() => application.dispatcher.kick(), 5000);
    application.dispatcher.kick();
    logger.log('info', 'server.started', { port, mail: application.dispatcher.status() });
    let stopping = false;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
      if (stopping) return;
      stopping = true;
      logger.log('info', 'server.stopping', { signal });
      clearInterval(dispatcher);
      void Promise.allSettled([listeningServer.close(), application.dispatcher.stop()]).then(async results => {
        await storage.close();
        if (results.some(result => result.status === 'rejected')) process.exitCode = 1;
      }).catch(error => {
        logger.log('error', 'server.stop_failed', { error: errorKind(error) });
        process.exitCode = 1;
      });
    });
  } catch (error) {
    await Promise.allSettled([server?.close(), storage.close()]);
    throw error;
  }
}
if (require.main === module) {
  const logger = createJsonLogger({ minLevel: process.env.LOG_LEVEL === 'debug' ? 'debug' : 'info' });
  process.on('unhandledRejection', reason => { logger.log('error', 'process.unhandled_rejection', { error: errorKind(reason) }); process.exit(1); });
  process.on('uncaughtException', error => { logger.log('error', 'process.uncaught_exception', { error: errorKind(error) }); process.exit(1); });
  void main(logger).catch(error => {
    logger.log('error', 'server.start_failed', { error: errorKind(error) });
    process.exitCode = 1;
  });
}
