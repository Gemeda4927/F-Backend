import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { audit } from '../audit/audit.js';
export class ReasonDto {
  @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
@Injectable()
export class DevicesService {
  constructor(private readonly db: PrismaService) {}
  current(id: string) {
    return this.db.studentDevice.findFirst({
      where: { user_id: id, revoked_at: null },
      select: {
        id: true,
        label: true,
        registered_at: true,
        last_seen_at: true,
      },
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
        data: { revoked_at: new Date() },
      });
      await tx.authSession.updateMany({
        where: { user_id: id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await audit(tx, { actor, target: id, action: 'DEVICE_RESET', description: 'Registered device reset and existing sessions revoked.', reason });
      return {
        message: 'Device reset. All existing student sessions are revoked.',
      };
    });
  }
}
@Controller('devices')
class DevicesController {
  constructor(private readonly service: DevicesService) {}
  @Get('me') current(@User() u: CurrentUser) {
    return this.service.current(u.id);
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
@Module({ controllers: [DevicesController], providers: [DevicesService], exports: [DevicesService] })
export class DevicesModule {}
