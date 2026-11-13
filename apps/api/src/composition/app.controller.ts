/**
 * Adapter HTTP. Il principal viene solo dalla sessione server: nessun actor ID
 * inviato dal client sostituisce l'identità. Ogni operazione usa la UnitOfWork.
 * Il token CSRF di sessione protegge tutti i comandi autenticati.
 */
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { Application } from './application';
import { AppError, Principal } from '../shared/contracts';

function sessionId(req: Request): string {
  const value = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('nt_session='));
  return value?.slice('nt_session='.length) ?? '';
}
function object(value: unknown, allowed: string[]): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('ValidationError', 400, 'Richiesta non valida.');
  const body = value as Record<string, any>;
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new AppError('ValidationError', 400, 'Campo non previsto dal contratto.');
  return body;
}
function jsonObject(req: Request, value: unknown, allowed: string[]) {
  if (!req.is('application/json')) throw new AppError('ValidationError', 400, 'Usare application/json.');
  return object(value, allowed);
}
function timeRange(value?: string): number | undefined {
  if (value === undefined) return undefined;
  const time = Date.parse(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new AppError('ValidationError', 400, 'Intervallo ISO con offset richiesto.');
  const [, year, month, day, hour, minute, second, zone] = match;
  const leap = +year % 4 === 0 && (+year % 100 !== 0 || +year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][+month - 1] ?? 0;
  const offset = zone === 'Z' ? [0, 0] : zone.slice(1).split(':').map(Number);
  if (+month < 1 || +month > 12 || +day < 1 || +day > days || +hour > 23 || +minute > 59 || +second > 59 || offset[0] > 23 || offset[1] > 59 || !Number.isFinite(time)) throw new AppError('ValidationError', 400, 'Intervallo temporale non valido.');
  return time;
}
@Controller('api')
export class AppController {
  constructor(@Inject(Application) private readonly app: Application) {}
  private async authorized<T>(req: Request, write: boolean, action: (user: Principal) => Promise<T>): Promise<T> {
    return this.app.persistence.run(async () => {
      const auth = await this.app.identity.authenticate(sessionId(req));
      if (write) {
        const supplied = Buffer.from(String(req.headers['x-csrf-token'] ?? ''));
        const actual = Buffer.from(auth.session.csrfToken);
        if (supplied.length !== actual.length || !timingSafeEqual(supplied, actual)) throw new AppError('CsrfError', 403, 'Sessione non valida per questa operazione.');
      }
      return action(auth.user);
    });
  }
  @Post('auth/login')
  async login(@Req() req: Request, @Body() value: unknown, @Res({ passthrough: true }) res: Response) {
    // Un POST JSON same-origin evita login CSRF tramite form esterno.
    const b = jsonObject(req, value, ['email', 'password']);
    return this.app.persistence.run(async () => {
      const auth = await this.app.identity.login(b.email, b.password);
      // Una nuova sessione sostituisce l'eventuale precedente, senza fissazione.
      if (sessionId(req)) await this.app.identity.logout(sessionId(req));
      res.cookie('nt_session', auth.session.id, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60 * 1000, path: '/' });
      return { user: auth.user, csrfToken: auth.session.csrfToken };
    });
  }
  @Post('auth/register')
  async register(@Req() req: Request, @Body() value: unknown) {
    const b = jsonObject(req, value, ['email', 'password', 'name', 'role']);
    const user = await this.app.persistence.run(() => this.app.identity.provision(b.email, b.password, b.name, b.role));
    return { user };
  }
  @Post('auth/forgot-password')
  @HttpCode(202)
  async forgotPassword(@Req() req: Request, @Body() value: unknown) {
    const b = jsonObject(req, value, ['email']);
    if (!this.app.sendPasswordReset) throw new AppError('PasswordResetUnavailable', 503, 'Il recupero via email non è disponibile al momento.');
    const result = await this.app.persistence.run(() => this.app.requestPasswordReset(b.email));
    // Invio dopo il commit, dall'outbox: esito e latenza del provider non arrivano al client.
    this.app.dispatcher.kick();
    return result;
  }
  /** Liveness: il processo risponde. Nessun accesso al database. */
  @Get('health/live') live() { return { status: 'ok' }; }
  /** Readiness: 200 se il servizio può operare (anche «degraded»), 503 se il database non risponde. */
  @Get('health/ready') async ready(@Res({ passthrough: true }) res: Response) {
    const health = await this.app.health();
    if (health.status === 'down') res.status(503).setHeader('Retry-After', '5');
    return health;
  }
  @Post('auth/reset-password')
  @HttpCode(200)
  async resetPassword(@Req() req: Request, @Body() value: unknown, @Res({ passthrough: true }) res: Response) {
    const b = jsonObject(req, value, ['token', 'password']);
    await this.app.persistence.run(() => this.app.identity.resetPassword(b.token, b.password));
    res.clearCookie('nt_session', { path: '/' });
    return { ok: true };
  }
  @Get('auth/me')
  me(@Req() req: Request) {
    return this.app.persistence.run(async () => {
      const auth = await this.app.identity.authenticate(sessionId(req));
      return { user: auth.user, csrfToken: auth.session.csrfToken };
    });
  }
  @Post('auth/logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.authorized(req, true, async () => {
      await this.app.identity.logout(sessionId(req)); res.clearCookie('nt_session', { path: '/' }); return { ok: true };
    });
  }
  @Get('profile')
  profile(@Req() req: Request) {
    return this.authorized(req, false, user => this.app.identity.getProfile(user));
  }
  @Patch('profile')
  updateProfile(@Req() req: Request, @Body() value: unknown) {
    const b = jsonObject(req, value, ['name', 'email', 'birthDate', 'heightCm', 'currentPassword']);
    return this.authorized(req, true, user => this.app.identity.updateProfile(user, b));
  }
  @Patch('account/password') changePassword(@Req() req: Request, @Body() value: unknown) {
    const b = jsonObject(req, value, ['currentPassword', 'newPassword']);
    return this.authorized(req, true, u => this.app.identity.changePassword(u, sessionId(req), b.currentPassword, b.newPassword));
  }
  @Get('account/export') exportAccount(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', 'attachment; filename="nutritrack-dati.json"');
    return this.authorized(req, false, u => this.app.exportAccount(u));
  }
  @Post('account/delete') @HttpCode(200) async deleteAccount(@Req() req: Request, @Body() value: unknown, @Res({ passthrough: true }) res: Response) {
    const b = jsonObject(req, value, ['password']);
    const result = await this.authorized(req, true, u => this.app.deleteAccount(u, b.password));
    res.clearCookie('nt_session', { path: '/' });
    return result;
  }
  @Patch('diary/entries/:id') correctMeal(@Req() req: Request, @Param('id') id: string, @Body() value: unknown) {
    const b = jsonObject(req, value, ['consumptionTime', 'actualConsumption']);
    return this.authorized(req, true, u => this.app.diary.correct(u, id, b));
  }
  @Delete('diary/entries/:id') removeMeal(@Req() req: Request, @Param('id') id: string) {
    return this.authorized(req, true, u => this.app.diary.remove(u, id));
  }
  @Patch('progress/measurements/:id') correctMeasurement(@Req() req: Request, @Param('id') id: string, @Body() value: unknown) {
    const b = jsonObject(req, value, ['value', 'timestamp']);
    return this.authorized(req, true, u => this.app.progress.correct(u, id, b));
  }
  @Delete('progress/measurements/:id') removeMeasurement(@Req() req: Request, @Param('id') id: string) {
    return this.authorized(req, true, u => this.app.progress.remove(u, id));
  }
  @Get('patients') listPatients(@Req() req: Request) { return this.authorized(req, false, u => this.app.patients.list(u)); }
  @Get('patients/invitations') invitations(@Req() req: Request) { return this.authorized(req, false, u => this.app.patients.invitations(u)); }
  @Post('patients/invitations') @HttpCode(202) async invite(@Req() req: Request, @Body() value: unknown) {
    const b = object(value, ['email']);
    const response = await this.authorized(req, true, u => this.app.inviteQuietly(u, b.email));
    // Come per il recupero password: avviso dopo il commit, dall'outbox.
    this.app.dispatcher.kick();
    return response;
  }
  @Post('patients/invitations/:id/accept') accept(@Req() req: Request, @Param('id') id: string) {
    return this.authorized(req, true, u => this.app.acceptInvitation(u, id));
  }
  @Post('patients/invitations/:id/close') closeInvitation(@Req() req: Request, @Param('id') id: string) {
    return this.authorized(req, true, u => this.app.patients.close(u, id));
  }
  @Get('plans/:patientId/history') history(@Req() req: Request, @Param('patientId') id: string) { return this.authorized(req, false, u => this.app.plans.history(u, id)); }
  @Post('patients/:patientId/end') end(@Req() req: Request, @Param('patientId') id: string) {
    return this.authorized(req, true, u => this.app.endAssociation(u, id));
  }
  @Get('plans/:patientId') async active(@Req() req: Request, @Param('patientId') id: string, @Res() res: Response) {
    const version = await this.authorized(req, false, u => this.app.plans.active(u, id));
    // Nest restituisce un corpo vuoto quando il valore è null: il contratto
    // richiede invece JSON null, altrimenti il browser non può decodificarlo.
    return res.status(200).json(version);
  }
  @Post('plans/:patientId') publish(@Req() req: Request, @Param('patientId') id: string, @Body() value: unknown) {
    const b = object(value, ['baseVersionId', 'content']);
    return this.authorized(req, true, u => this.app.plans.publish(u, id, b.baseVersionId, b.content));
  }
  @Get('diary/:patientId') diary(@Req() req: Request, @Param('patientId') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.authorized(req, false, u => this.app.diary.list(u, id, timeRange(from), timeRange(to)));
  }
  @Post('diary') recordMeal(@Req() req: Request, @Body() value: unknown) {
    const b = object(value, ['operationId', 'consumptionTime', 'actualConsumption']);
    return this.authorized(req, true, u => this.app.diary.record(u, b as any));
  }
  @Get('sharing') sharing(@Req() req: Request) { return this.authorized(req, false, u => this.app.diary.sharing(u)); }
  @Put('sharing') setSharing(@Req() req: Request, @Body() value: unknown) {
    const b = object(value, ['enabled']); return this.authorized(req, true, u => this.app.diary.setSharing(u, b.enabled));
  }
  @Get('progress/photos') listProgressPhotos(@Req() req: Request) {
    return this.authorized(req, false, u => this.app.progressPhotos.list(u));
  }
  @Post('progress/photos') addProgressPhoto(@Req() req: Request, @Body() value: unknown) {
    const b = jsonObject(req, value, ['operationId', 'timestamp', 'dataUrl']);
    return this.authorized(req, true, u => this.app.progressPhotos.add(u, b));
  }
  @Get('progress/photos/:id') async progressPhoto(@Req() req: Request, @Param('id') id: string, @Res() res: Response) {
    const photo = await this.authorized(req, false, u => this.app.progressPhotos.get(u, id));
    res.type(photo.mimeType).set('Content-Length', String(photo.bytes.length)).end(photo.bytes);
  }
  @Delete('progress/photos/:id') deleteProgressPhoto(@Req() req: Request, @Param('id') id: string) {
    return this.authorized(req, true, u => this.app.progressPhotos.delete(u, id));
  }
  @Get('progress/:patientId') progress(@Req() req: Request, @Param('patientId') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.authorized(req, false, u => this.app.progress.list(u, id, timeRange(from), timeRange(to)));
  }
  @Post('progress') recordMeasurement(@Req() req: Request, @Body() value: unknown) {
    const b = object(value, ['operationId', 'timestamp', 'value', 'type', 'unit']);
    return this.authorized(req, true, u => this.app.progress.record(u, b as any));
  }
}
