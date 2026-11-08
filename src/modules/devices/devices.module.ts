import {
  Body,
  ConflictException,
  ServiceUnavailableException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  IsOptional,
  IsUUID,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { encryptPushToken, tokenHash } from './push-token.js';
import { audit } from '../audit/audit.js';
class RegisterDeviceDto {
  @IsUUID() installation_id!: string;
  @IsOptional() @IsString() @MinLength(20) @MaxLength(4096) fcm_token?: string;
  @IsOptional() @IsString() @MaxLength(80) browser?: string;
  @IsOptional() @IsString() @MaxLength(80) operating_system?: string;
  @IsOptional() @IsString() @MaxLength(100) device_name?: string;
}
export class ReasonDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
@Injectable()
export class DevicesService {
  constructor(private readonly db: PrismaService) {}
  current(id: string, sessionId?: string) {
    return this.db.studentDevice.findFirst({
      where: {
        user_id: id,
        revoked_at: null,
        ...(sessionId
          ? { sessions: { some: { id: sessionId, revoked_at: null } } }
          : {}),
      },
      orderBy: { registered_at: 'desc' },
      select: {
        id: true,
        label: true,
        platform: true,
        browser: true,
        operating_system: true,
        revoked_at: true,
        push_updated_at: true,
        registered_at: true,
        last_seen_at: true,
      },
    });
  }
  register(user: CurrentUser, dto: RegisterDeviceDto) {
    if (user.role !== 'STUDENT')
      throw new ForbiddenException('Student registration required');
    if (
      dto.fcm_token &&
      !/^[a-f0-9]{64}$/i.test(process.env.PUSH_TOKEN_ENCRYPTION_KEY ?? '')
    )
      throw new ServiceUnavailableException(
        'Push messaging is not configured. Your learning device remains authorized.',
      );
    const encrypted = dto.fcm_token
      ? encryptPushToken(dto.fcm_token)
      : undefined;
    return this.db.atomic(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { auth_version: { increment: 1 } },
      });
      const device = await tx.studentDevice.findFirst({
        where: {
          user_id: user.id,
          revoked_at: null,
          sessions: { some: { id: user.sessionId, revoked_at: null } },
        },
      });
      if (!device)
        throw new ForbiddenException(
          'Sign in on your authorized installation first',
        );
      const hash = tokenHash(dto.installation_id);
      if (device.installation_hash && device.installation_hash !== hash)
        throw new ConflictException(
          'Request a verified device change before registering another installation.',
        );
      const other = await tx.studentDevice.findFirst({
        where: {
          installation_hash: hash,
          revoked_at: null,
          user_id: { not: user.id },
        },
      });
      if (other)
        throw new ConflictException(
          'This installation is already registered. Contact support for recovery.',
        );
      if (dto.fcm_token) {
        const duplicate = await tx.studentDevice.findFirst({
          where: {
            fcm_token_hash: tokenHash(dto.fcm_token),
            revoked_at: null,
            id: { not: device.id },
          },
        });
        if (duplicate)
          throw new ConflictException(
            'Messaging registration is unavailable. Contact support.',
          );
      }
      await tx.studentDevice.update({
        where: { id: device.id },
        data: {
          installation_hash: hash,
          platform: 'web',
          browser: dto.browser,
          operating_system: dto.operating_system,
          ...(dto.device_name ? { label: dto.device_name } : {}),
          last_seen_at: new Date(),
          ...(encrypted
            ? {
                fcm_token_encrypted: encrypted,
                fcm_token_hash: tokenHash(dto.fcm_token!),
                push_updated_at: new Date(),
              }
            : {}),
        },
      });
      if (
        !device.installation_hash ||
        (dto.fcm_token && device.fcm_token_hash !== tokenHash(dto.fcm_token))
      )
        await audit(tx, {
          actor: user,
          target: user.id,
          action: device.installation_hash
            ? 'PUSH_REGISTRATION_UPDATED'
            : 'INSTALLATION_REGISTERED',
          description:
            'Authorized installation messaging registration updated.',
          resourceType: 'DEVICE',
          resourceId: device.id,
        });
      return {
        registered: true,
        push_enabled: !!(encrypted || device.fcm_token_encrypted),
      };
    });
  }
  requestChange(user: CurrentUser, reason: string) {
    if (user.role !== 'STUDENT')
      throw new ForbiddenException('Student account required');
    return this.db.atomic(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { auth_version: { increment: 1 } },
      });
      const latest = await tx.auditLog.findFirst({
        where: {
          target_id: user.id,
          action: {
            in: [
              'DEVICE_CHANGE_REQUESTED',
              'DEVICE_RESET',
              'PASSWORD_RECOVERY',
            ],
          },
        },
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      });
      if (latest?.action !== 'DEVICE_CHANGE_REQUESTED')
        await audit(tx, {
          actor: user,
          target: user.id,
          action: 'DEVICE_CHANGE_REQUESTED',
          description: 'Student requested a verified device change.',
          reason,
        });
      return {
        requested: true,
        message:
          'Request recorded. Your current installation remains authorized until verified recovery or administrator reset.',
      };
    });
  }
  async requests() {
    const rows = await this.db.auditLog.findMany({
      where: { action: 'DEVICE_CHANGE_REQUESTED' },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const relevant = rows.filter((row): row is typeof row & { target_id: string } => row.target_id !== null);
    const ids = [...new Set(relevant.map((row) => row.target_id))];
    const [users, resolutions] = await Promise.all([
      this.db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      }),
      this.db.auditLog.findMany({
        where: {
          target_id: { in: ids },
          action: { in: ['DEVICE_RESET', 'PASSWORD_RECOVERY'] },
        },
        select: { target_id: true, created_at: true },
      }),
    ]);
    const seen = new Set<string>();
    return relevant
      .filter((row) => {
        if (seen.has(row.target_id)) return false;
        seen.add(row.target_id);
        return !resolutions.some(
          (event) =>
            event.target_id === row.target_id &&
            event.created_at >= row.created_at,
        );
      })
      .map((row) => ({
        id: row.id,
        student_id: row.target_id,
        student_name:
          users.find((user) => user.id === row.target_id)?.name ?? 'Student',
        reason: row.reason,
        created_at: row.created_at,
      }));
  }
  history(id: string) {
    return this.db.studentDevice.findMany({
      where: { user_id: id },
      select: {
        id: true,
        label: true,
        platform: true,
        browser: true,
        operating_system: true,
        registered_at: true,
        last_seen_at: true,
        revoked_at: true,
      },
      orderBy: { registered_at: 'desc' },
      take: 50,
    });
  }
  reset(actor: CurrentUser, id: string, reason: string) {
    return this.db.atomic(async (tx) => {
      const target = await tx.user.findUnique({ where: { id } });
      if (!target || target.role !== 'STUDENT')
        throw new ForbiddenException(
          'Only student device registrations can be reset',
        );
      await tx.user.update({
        where: { id },
        data: { auth_version: { increment: 1 } },
      });
      await tx.studentDevice.updateMany({
        where: { user_id: id, revoked_at: null },
        data: {
          revoked_at: new Date(),
          fcm_token_encrypted: null,
          fcm_token_hash: null,
        },
      });
      await tx.authSession.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await audit(tx, {
        actor,
        target: id,
        action: 'DEVICE_RESET',
        description: 'Registered device reset and existing sessions revoked.',
        reason,
      });
      return {
        message: 'Device reset. All existing student sessions are revoked.',
      };
    });
  }
}
@Controller('devices')
class DevicesController {
  constructor(private readonly service: DevicesService) {}
  @Post('me/change-request') requestChange(
    @User() user: CurrentUser,
    @Body() dto: ReasonDto,
  ) {
    return this.service.requestChange(user, dto.reason);
  }
  @Permissions('devices:reset') @Get('requests') requests() {
    return this.service.requests();
  }
  @Post('me/register') register(
    @User() u: CurrentUser,
    @Body() dto: RegisterDeviceDto,
  ) {
    return this.service.register(u, dto);
  }
  @Get('me/history') history(@User() u: CurrentUser) {
    return this.service.history(u.id);
  }
  @Permissions('devices:reset') @Get('student/:id/history') studentHistory(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.history(id);
  }
  @Get('me') current(@User() u: CurrentUser) {
    return this.service.current(u.id, u.sessionId);
  }
  @Permissions('devices:reset') @Get('student/:id') student(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.current(id);
  }
  @Permissions('devices:reset')
  @Post('student/:id/reset')
  reset(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.service.reset(u, id, dto.reason);
  }
}
@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
