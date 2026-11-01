import {
  Controller,
  Get,
  Module,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Public } from '../../common/decorators/permissions.js';
import { PrismaService } from '../../prisma/prisma.service.js';
@Public()
@Controller('health')
class HealthController {
  constructor(private readonly db: PrismaService) {}
  @Get() getHealth() {
    return { status: 'ok' };
  }
  @Get('database') async database() {
    try {
      await this.db.user.count();
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }
}
@Module({ controllers: [HealthController] })
export class HealthModule {}
