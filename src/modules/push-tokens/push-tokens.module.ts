import {
  Body,
  Controller,
  Injectable,
  Module,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { encryptPushToken, tokenHash } from './push-token.js';

class RegisterPushTokenDto {
  @IsString() @MinLength(20) @MaxLength(4096) fcm_token!: string;
  @IsOptional() @IsIn(['granted', 'denied', 'default']) permission_status?: string;
}

@Injectable()
export class PushTokensService {
  constructor(private readonly db: PrismaService) {}

  async register(user: CurrentUser, dto: RegisterPushTokenDto) {
    if (!/^[a-f0-9]{64}$/i.test(process.env.PUSH_TOKEN_ENCRYPTION_KEY ?? ''))
      throw new ServiceUnavailableException('Push notifications are not configured yet.');
    const hash = tokenHash(dto.fcm_token);
    const encrypted = encryptPushToken(dto.fcm_token);
    await this.db.fcmToken.upsert({
      where: { token_hash: hash },
      create: {
        user_id: user.id,
        token_encrypted: encrypted,
        token_hash: hash,
        permission_status: dto.permission_status ?? 'granted',
      },
      update: {
        user_id: user.id,
        token_encrypted: encrypted,
        permission_status: dto.permission_status ?? 'granted',
        last_seen_at: new Date(),
      },
    });
    return { registered: true, push_enabled: true };
  }

  revoke(user: CurrentUser) {
    return this.db.fcmToken.deleteMany({ where: { user_id: user.id } }).then(() => ({ revoked: true }));
  }
}

@Controller('push-tokens')
class PushTokensController {
  constructor(private readonly service: PushTokensService) {}
  @Post('register') register(@User() user: CurrentUser, @Body() dto: RegisterPushTokenDto) {
    return this.service.register(user, dto);
  }
  @Post('revoke') revoke(@User() user: CurrentUser) {
    return this.service.revoke(user);
  }
}

@Module({ controllers: [PushTokensController], providers: [PushTokensService], exports: [PushTokensService] })
export class PushTokensModule {}
