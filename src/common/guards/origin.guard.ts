import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { getAllowedFrontendOrigins } from '../../config/allowed-origins.js';
@Injectable()
export class OriginGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<Request>();
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ||
      req.path.endsWith('/payments/webhook')
    )
      return true;
    // Cookie-authenticated mutations require the configured frontend Origin.
    const allowed = getAllowedFrontendOrigins();
    if (!req.headers.origin || !allowed.includes(req.headers.origin))
      throw new ForbiddenException('Untrusted request origin');
    return true;
  }
}
