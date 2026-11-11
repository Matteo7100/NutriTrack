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
import { resolve } from 'node:path';
import { Request, Response, NextFunction } from 'express';
import { AppError } from '../shared/contracts';
import { Application } from './application';
import { AppController } from './app.controller';
import { PostgresStorageFactory } from '../infrastructure/persistence';
import { createPasswordResetSender } from '../infrastructure/password-reset-mail';

const authRequestLimits = new Map([
  ['/api/auth/login', 30],
  ['/api/auth/register', 12],
  ['/api/auth/forgot-password', 8],
  ['/api/auth/reset-password', 20],
]);

@Catch()
class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (error instanceof AppError) return res.status(error.status).json({ code: error.code, message: error.message });
    if (error instanceof HttpException) return res.status(error.getStatus()).json({ code: 'HttpError', message: error.message });
    // Non esporre query, credenziali o stack al client.
    console.error('Errore applicativo non gestito:', error instanceof Error ? error.name : 'unknown');
    return res.status(500).json({ code: 'InternalError', message: 'Operazione non completata. Riprovare.' });
  }
}
export async function createServer(application: Application, quiet = false) {
  @Module({ controllers: [AppController], providers: [{ provide: Application, useValue: application }] })
  class ApiModule {}
  const server = await NestFactory.create(ApiModule, { logger: quiet ? false : ['error', 'warn', 'log'] });
  server.useGlobalFilters(new ErrorFilter());
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
    const limit = req.method === 'POST' ? authRequestLimits.get(path) : undefined;
    if (limit !== undefined) {
      const now = Date.now(), key = `${path}:${req.ip ?? 'local'}`;
      if (authRequests.size > 10000) authRequests.clear();
      const item = authRequests.get(key);
      const bucket = item && now - item.start < 60000 ? item : { count: 0, start: now };
      authRequests.set(key, bucket); bucket.count++;
      if (bucket.count > limit) return res.status(429).json({ code: 'RateLimit', message: 'Troppi tentativi. Attendere un minuto.' });
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

async function main() {
  const storage = new PostgresStorageFactory();
  const application = new Application(storage, Date.now, createPasswordResetSender(process.env));
  // Connessione reale verificata prima di accettare richieste.
  await application.persistence.run(async () => undefined);
  const server = await createServer(application);
  await server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void server.close().then(() => storage.close()).then(() => process.exit(0));
  });
}
if (require.main === module) void main().catch(error => { console.error(error); process.exitCode = 1; });
