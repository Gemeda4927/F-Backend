import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthRequest, Role } from '../types.js';
import type { Permission } from '../../modules/roles/permissions.js';
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: PrismaService,
  ) {}
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    if (
      this.reflector.getAllAndOverride<boolean>('public', [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    let grants: string[] = [];
    try {
      const payload = jwt.verify(
        req.cookies?.access_token,
        process.env.JWT_ACCESS_SECRET!,
        { algorithms: ['HS256'], issuer: 'freshman', audience: 'freshman-web' },
      ) as jwt.JwtPayload;
      const session = await this.db.authSession.findFirst({
        where: {
          id: payload.sid,
          user_id: payload.sub,
          revoked_at: null,
          expires_at: { gt: new Date() },
          user: { active: true },
        },
        include: {
          studentDevice: true,
          user: {
            include: { roleDefinition: { include: { permissions: true } } },
          },
        },
      });
      if (!session) throw Error('Session revoked');
      const user = session.user,
        device = session.studentDevice;
      if (
        user.role === 'STUDENT' &&
        (!device ||
          device.revoked_at ||
          !req.cookies?.device_token ||
          createHash('sha256')
            .update(req.cookies.device_token)
            .digest('hex') !== device.token_hash)
      )
        throw Error('Device revoked');
      if (device && device.last_seen_at.getTime() < Date.now() - 300000)
        await this.db.studentDevice.updateMany({ where: { id: device.id, revoked_at: null }, data: { last_seen_at: new Date() } });
      if (!user.roleDefinition || user.roleDefinition.name !== user.role)
        throw Error('Role configuration missing');
      grants = user.roleDefinition.permissions.map((p) => p.permission_code);
      req.user = {
        permissions: grants,
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.roleDefinition.name as Role,
        sessionId: session.id,
      };
    } catch {
      throw new UnauthorizedException(
        'Your session has expired. Please sign in again.',
      );
    }
    const permissions =
      this.reflector.getAllAndOverride<Permission[]>('permissions', [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (permissions.some((p) => !grants.includes(p)))
      throw new ForbiddenException(
        'You do not have permission for this action',
      );
    return true;
  }
}
