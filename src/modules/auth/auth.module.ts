import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { MailService } from './mail.service.js';
@Module({
  controllers: [AuthController],
  providers: [AuthService, MailService],
})
export class AuthModule {}
