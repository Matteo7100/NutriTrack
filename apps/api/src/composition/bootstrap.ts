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
import { Persistence, PostgresPersistence } from '../infrastructure/persistence';

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
  const failures = new Map<string, { count: number; start: number }>();
  server.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'");
    if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store');
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin) {
      // Browser same-origin: evita login CSRF. Nessun CORS indiscriminato.
      try { if (new URL(origin).host !== req.headers.host) throw new Error(); }
      catch { return res.status(403).json({ code: 'OriginError', message: 'Origine non consentita.' }); }
    }
    if (req.path === '/api/auth/login' && req.method === 'POST') {
      const now = Date.now(), key = req.ip ?? 'local';
      if (failures.size > 10000) failures.clear();
      const item = failures.get(key);
      const bucket = item && now - item.start < 60000 ? item : { count: 0, start: now };
      failures.set(key, bucket); bucket.count++;
      if (bucket.count > 30) return res.status(429).json({ code: 'RateLimit', message: 'Troppi tentativi. Attendere un minuto.' });
    }
    next();
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
  const persistence: Persistence = new PostgresPersistence();
  const application = new Application(persistence);
  // Connessione reale verificata prima di accettare richieste.
  await persistence.run(async () => undefined);
  const server = await createServer(application);
  await server.listen(Number(process.env.PORT ?? 3000), '127.0.0.1');
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => {
    void server.close().then(() => persistence.close()).then(() => process.exit(0));
  });
}
if (require.main === module) void main().catch(error => { console.error(error); process.exitCode = 1; });
