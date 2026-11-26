import {
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
class DeleteUserDto {
  @IsOptional() reason?: string;
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
      await tx.fcmToken.deleteMany({ where: { user_id: id } });
      await audit(tx, { actor, target: id, action: dto.role ? 'ROLE_CHANGED' : 'USER_UPDATE', description: 'Account permissions or active status updated; sessions and push tokens revoked.', oldValues: { role: target.role, active: target.active }, newValues: { role: user.role, active: user.active } });
      return user;
    });
  }
  @Delete(':id') async remove(
    @User() actor: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteUserDto,
  ) {
    if (actor.role !== 'SUPER_ADMIN' || actor.id === id)
      throw new ForbiddenException('Only a Super Admin can delete another account');
    const transfer = await this.db.atomic(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.role !== 'INSTRUCTOR')
        throw new ForbiddenException('Only instructor accounts can be deleted here');
      const result = await tx.course.updateMany({
        where: { instructor_id: id },
        data: { instructor_id: actor.id },
      });
      if (result.count) {
        await audit(tx, {
          actor,
          target: id,
          action: 'INSTRUCTOR_COURSES_TRANSFERRED_TO_SUPER_ADMIN',
          description: `${result.count} course(s) transferred before instructor deletion.`,
          reason: dto.reason?.trim() || 'Super Admin account deletion.',
          resourceType: 'USER',
          resourceId: id,
          oldValues: { instructor_id: id },
          newValues: { instructor_id: actor.id, transferred_courses: result.count },
        });
      }
      return { target, count: result.count };
    });
    return this.db.atomic(async (tx) => {
      await tx.authSession.deleteMany({ where: { user_id: id } });
      await tx.passwordResetToken.deleteMany({ where: { user_id: id } });
      try {
        await tx.user.delete({ where: { id } });
      } catch (error) {
        if ((error as { code?: string }).code === 'P2003')
          throw new ConflictException(`Courses transferred to your Super Admin account. ${transfer.target.name} was not deleted because protected academic history remains. Deactivate the account to revoke access instead.`);
        throw error;
      }
      await audit(tx, { actor, target: id, action: 'INSTRUCTOR_DELETED', description: `Instructor account ${transfer.target.email} was permanently deleted after transferring ${transfer.count} course(s) to Super Admin ownership.`, reason: dto.reason?.trim() || 'Super Admin account deletion.' });
      return { deleted: true, transferred_courses: transfer.count, message: `Instructor deleted. ${transfer.count} course(s) transferred to your Super Admin account.` };
    });
  }
  @Post(':id/transfer-courses-to-me') transferCoursesToMe(
    @User() actor: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeleteUserDto,
  ) {
    if (actor.role !== 'SUPER_ADMIN' || actor.id === id)
      throw new ForbiddenException('Only a Super Admin can transfer another instructor\'s courses');
    return this.db.atomic(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.role !== 'INSTRUCTOR')
        throw new ForbiddenException('Only instructor-owned courses can be transferred here');
      const result = await tx.course.updateMany({
        where: { instructor_id: id },
        data: { instructor_id: actor.id },
      });
      await audit(tx, {
        actor,
        target: id,
        action: 'INSTRUCTOR_COURSES_TRANSFERRED_TO_SUPER_ADMIN',
        description: `${result.count} course(s) transferred to Super Admin ownership.`,
        reason: dto.reason?.trim() || 'Super Admin ownership transfer.',
        resourceType: 'USER',
        resourceId: id,
        oldValues: { instructor_id: id },
        newValues: { instructor_id: actor.id, transferred_courses: result.count },
      });
      return {
        transferred: true,
        course_count: result.count,
        message: result.count
          ? `${result.count} course(s) transferred to your Super Admin account.`
          : 'This instructor has no owned courses to transfer.',
      };
    });
  }
}
@Module({ controllers: [UsersController] })
export class UsersModule {}
