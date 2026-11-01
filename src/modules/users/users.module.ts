import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser, Role } from '../../common/types.js';
import { audit } from '../audit/audit.js';
import { PrismaService } from '../../prisma/prisma.service.js';
class UpdateUserDto {
  @IsOptional()
  @IsIn(['SUPER_ADMIN', 'ADMIN', 'INSTRUCTOR', 'STUDENT'])
  role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
}
@Controller('users')
@Permissions('users:manage')
class UsersController {
  constructor(private readonly db: PrismaService) {}
  @Get() list(@Query('search') search = '', @Query('role') role?: string) {
    const contains = search.slice(0, 100);
    return this.db.user.findMany({
      where: {
        ...(role && ['STUDENT', 'INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'].includes(role) ? { role } : {}),
        OR: [
          { email: { contains, mode: 'insensitive' } },
          { name: { contains, mode: 'insensitive' } },
        ],
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        active: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
  }
  @Patch(':id') update(
    @User() actor: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.db.atomic(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.role === 'SUPER_ADMIN' || id === actor.id)
        throw new ForbiddenException('Cannot modify this account');
      if (dto.role && actor.role !== 'SUPER_ADMIN')
        throw new ForbiddenException('Only super admins can change roles');
      if (
        actor.role === 'ADMIN' &&
        !['STUDENT', 'INSTRUCTOR'].includes(target.role)
      )
        throw new ForbiddenException('Cannot modify an administrator');
      const user = await tx.user.update({
        where: { id },
        data: {
          role:dto.role,active:dto.active, ...(dto.active !== undefined ? { suspended: false } : {}),
          ...(dto.role ? { role_id: dto.role } : {}),
          auth_version: { increment: 1 },
        },
        select: { id: true, email: true, name: true, role: true, active: true },
      });
      await tx.authSession.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await tx.studentDevice.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await audit(tx, { actor, target: id, action: dto.role ? 'ROLE_CHANGED' : 'USER_UPDATE', description: 'Account permissions or status updated; sessions and device registrations revoked.', oldValues: { role: target.role, active: target.active }, newValues: { role: user.role, active: user.active } });
      return user;
    });
  }
}
@Module({ controllers: [UsersController] })
export class UsersModule {}
