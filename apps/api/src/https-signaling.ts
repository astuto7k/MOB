import { BadRequestException, Body, Controller, ForbiddenException, Get, Inject, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { Db } from './db';
import { HubService, sessionView } from './hub';
import { AuthGuard, AuthedRequest, Principal } from './security';
import { parse, signaling, uuid } from './validation';

@UseGuards(AuthGuard)
@Controller('sessions/:id/signal')
export class HttpsSignalingController {
  constructor(@Inject(Db) private readonly db: Db, @Inject(HubService) private readonly hub: HubService) {}
  private async touch(sessionId: string, principal: Principal, join = false) {
    const role = principal.kind;
    const now = new Date();
    if (join) await this.db.signalPeer.upsert({
      where: { sessionId_role: { sessionId, role } },
      create: { sessionId, role, lastSeenAt: now }, update: { lastSeenAt: now },
    });
    else {
      const changed = await this.db.signalPeer.updateMany({ where: { sessionId, role }, data: { lastSeenAt: now } });
      if (!changed.count) throw new BadRequestException({ code: 'JOIN_REQUIRED', message: 'Entre na sinalização antes de enviar mensagens.' });
    }
    const peer = await this.db.signalPeer.findUnique({ where: { sessionId_role: { sessionId, role: role === 'admin' ? 'device' : 'admin' } } });
    const peerPresent = !!peer && peer.lastSeenAt.getTime() > Date.now() - 10_000;
    if (peerPresent) await this.hub.markConnecting(sessionId);
    return peerPresent;
  }
  @Get()
  async read(@Param('id') rawId: string, @Query('after') rawAfter: string | undefined, @Req() req: AuthedRequest) {
    const id = parse(uuid, rawId);
    const current = await this.hub.getSession(req.principal, id);
    if (req.principal.kind === 'admin' && current.adminSessionId !== req.principal.adminSessionId) throw new ForbiddenException();
    if (!['APPROVED', 'CONNECTING', 'ACTIVE'].includes(current.status)) return { messages: [], peerPresent: false, session: sessionView(current) };
    await this.hub.signalAuthorized(req.principal, id);
    const after = parse(z.coerce.number().int().min(0).max(2147483647).default(0), rawAfter);
    const peerPresent = await this.touch(id, req.principal);
    const messages = await this.db.signalMessage.findMany({
      where: { sessionId: id, sender: { not: req.principal.kind }, seq: { gt: after }, createdAt: { gt: new Date(Date.now() - 120_000) } },
      orderBy: { seq: 'asc' }, take: 100,
      select: { seq: true, sessionId: true, type: true, payload: true },
    });
    return { messages, peerPresent, session: sessionView(await this.hub.getSession(req.principal, id)) };
  }
  @Post()
  async write(@Param('id') rawId: string, @Body() body: unknown, @Req() req: AuthedRequest) {
    const id = parse(uuid, rawId), message = parse(signaling, body);
    if (message.sessionId !== id) throw new BadRequestException();
    await this.hub.signalAuthorized(req.principal, id);
    const peerPresent = await this.touch(id, req.principal, message.type === 'join');
    if (message.type === 'join') return { ok: true, peerPresent };
    if ((message.type === 'offer' && req.principal.kind !== 'admin') ||
        (message.type === 'answer' && req.principal.kind !== 'device') ||
        ((message.type === 'offer' || message.type === 'answer') && message.payload.type !== message.type)) throw new ForbiddenException();
    await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM remote_sessions WHERE id=${id}::uuid FOR UPDATE`;
      await tx.signalMessage.deleteMany({ where: { sessionId: id, createdAt: { lt: new Date(Date.now() - 120_000) } } });
      if (await tx.signalMessage.count({ where: { sessionId: id } }) >= 512) throw new BadRequestException({ code: 'SIGNAL_LIMIT', message: 'Limite de negociação atingido. Inicie uma nova sessão.' });
      await tx.signalMessage.create({ data: { sessionId: id, sender: req.principal.kind, type: message.type, payload: message.payload as Prisma.InputJsonValue } });
    });
    return { ok: true, peerPresent };
  }
}
