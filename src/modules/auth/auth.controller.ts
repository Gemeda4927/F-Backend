import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response, CookieOptions } from 'express';
import { Public, User } from '../../common/decorators/permissions.js';
import type { AuthRequest, CurrentUser } from '../../common/types.js';
import { AuthService } from './auth.service.js';
import {
  ForgotDto,
  LoginDto,
  ProfileDto,
  RegisterDto,
  ResetDto,
} from './auth.dto.js';

@Controller('auth')
export class AuthController {
  constructor(private readonly service: AuthService) {}
  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: process.env.COOKIE_SECURE === 'true',
      sameSite: process.env.COOKIE_SAME_SITE === 'none' ? 'none' : 'lax',
      path: '/api/v1',
    };
  }
  private issue(
    res: Response,
    result: { access: string; refresh: string; device?: string; user: unknown },
  ) {
    const options = this.cookieOptions();
    res.cookie('access_token', result.access, {
      ...options,
      maxAge: 15 * 60 * 1000,
    });
    res.cookie('refresh_token', result.refresh, {
      ...options,
      maxAge: 30 * 86400000,
    });
    if (result.device)
      res.cookie('device_token', result.device, {
        ...options,
        maxAge: 365 * 86400000,
      });
    return result.user;
  }
  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issue(
      res,
      await this.service.register(
        dto,
        req.cookies?.device_token,
        req.headers['user-agent'] ?? '',
      ),
    );
  }
  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issue(
      res,
      await this.service.login(
        dto,
        req.cookies?.device_token,
        req.headers['user-agent'] ?? '',
      ),
    );
  }
  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.issue(
      res,
      await this.service.refresh(
        req.cookies?.refresh_token,
        req.cookies?.device_token,
      ),
    );
  }
  @Post('logout')
  @HttpCode(200)
  async logout(
    @User() user: CurrentUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.service.logout(user);
    res.clearCookie('access_token', this.cookieOptions());
    res.clearCookie('refresh_token', this.cookieOptions());
    return { message: 'Signed out' };
  }
  @Get('me') me(@User() user: CurrentUser) {
    return { id: user.id, email: user.email, name: user.name, role: user.role };
  }
  @Post('profile') profile(@User() user: CurrentUser, @Body() dto: ProfileDto) {
    return this.service.profile(user, dto.name);
  }
  @Public()
  @Post('forgot-password')
  @Throttle({ default: { limit: 3, ttl: 60000 } })
  forgot(@Body() dto: ForgotDto) {
    return this.service.forgot(dto.email);
  }
  @Public()
  @Post('reset-password')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  reset(@Body() dto: ResetDto) {
    return this.service.reset(dto);
  }
}
