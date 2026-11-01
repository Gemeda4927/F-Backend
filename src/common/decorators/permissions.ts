import {
  SetMetadata,
  createParamDecorator,
  ExecutionContext,
} from '@nestjs/common';
import type { Permission } from '../../modules/roles/permissions.js';
import type { AuthRequest } from '../types.js';
export const Public = () => SetMetadata('public', true);
export const Permissions = (...permissions: Permission[]) =>
  SetMetadata('permissions', permissions);
export const User = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<AuthRequest>().user,
);
