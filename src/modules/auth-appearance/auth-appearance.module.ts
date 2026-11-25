import { Body, Controller, Delete, Get, Module, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Permissions, Public, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { AuthAppearanceDto } from './auth-appearance.dto.js';
import { AuthAppearanceService } from './auth-appearance.service.js';

@Controller('auth-appearance')
export class AuthAppearanceController {
  constructor(private readonly service: AuthAppearanceService) {}
  @Public() @Get() getPublic() { return this.service.publicAppearance(); }
  @Permissions('roles:manage') @Get('admin') getAdmin() { return this.service.adminAppearance(); }
  @Permissions('roles:manage') @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  update(@User() user: CurrentUser, @Body() dto: AuthAppearanceDto, @UploadedFile() file?: Express.Multer.File) { return this.service.update(user, dto, file); }
  @Permissions('roles:manage') @Delete() restore() { return this.service.restore(); }
}

@Module({ controllers: [AuthAppearanceController], providers: [AuthAppearanceService] })
export class AuthAppearanceModule {}
