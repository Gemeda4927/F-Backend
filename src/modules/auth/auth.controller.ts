import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
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
  ValidateResetDto,
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
    result: { access: string; refresh: string; user: unknown },
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
    res.clearCookie('device_token', options);
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
      ),
    );
  }
  @Public()
  @Get('google/start')
  googleStart(@Res() res: Response) {
    const result = this.service.googleStart();
    this.googleCookies(res, result.state, result.nonce, result.intent);
    return res.redirect(result.url);
  }
  @Get('google/link/start')
  googleLinkStart(@User() user: CurrentUser, @Res() res: Response) {
    const result = this.service.googleStart(user.id);
    this.googleCookies(res, result.state, result.nonce, result.intent);
    return res.redirect(result.url);
  }
  @Public()
  @Get('google/callback')
  async googleCallback(@Req() req: AuthRequest, @Res() res: Response) {
    const clear = { path: '/api/v1' };
    const state = req.cookies?.google_oauth_state;
    const nonce = req.cookies?.google_oauth_nonce;
    const intent = req.cookies?.google_oauth_intent;
    res.clearCookie('google_oauth_state', clear);
    res.clearCookie('google_oauth_nonce', clear);
    res.clearCookie('google_oauth_intent', clear);
    try {
      const currentUserId =
        intent === 'link'
          ? await this.service.currentGoogleLinkUser(
              req.cookies?.access_token,
            )
          : undefined;
      const result = await this.service.googleCallback(
        req.query.code as string | undefined,
        req.query.state as string | undefined,
        state,
        nonce,
        intent,
        req.headers['user-agent'] ?? '',
        currentUserId,
      );
      if ('linked' in result)
        return res.redirect(
          `${process.env.FRONTEND_URL}/profile?google_linked=1`,
        );
      this.issue(res, result);
      return res.redirect(`${process.env.FRONTEND_URL}/google/callback`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Google sign-in failed';
      return res.redirect(
        `${process.env.FRONTEND_URL}/login?google_error=${encodeURIComponent(message)}`,
      );
    }
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
    res.clearCookie('device_token', this.cookieOptions());
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
  @Public()
  @Get('reset-password/validate')
  validateReset(@Query() dto: ValidateResetDto) {
    return this.service.validateReset(dto.token);
  }
  private googleCookies(
    res: Response,
    state: string,
    nonce: string,
    intent: string,
  ) {
    const options = { ...this.cookieOptions(), maxAge: 10 * 60 * 1000 };
    res.cookie('google_oauth_state', state, options);
    res.cookie('google_oauth_nonce', nonce, options);
    res.cookie('google_oauth_intent', intent, options);
  }
}
