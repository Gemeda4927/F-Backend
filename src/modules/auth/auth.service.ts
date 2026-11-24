import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';
import type { User as DbUser } from '../../generated/prisma/client.js';
import type { LoginDto, RegisterDto, ResetDto } from './auth.dto.js';
import { audit } from '../audit/audit.js';
import { MailService } from './mail.service.js';
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
const publicUser = (u: DbUser) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});
@Injectable()
export class AuthService {
  constructor(
    private readonly db: PrismaService,
    private readonly mail: MailService,
  ) {}
  private passwordValid(password: string) {
    if (Buffer.byteLength(password, 'utf8') > 72)
      throw new BadRequestException('Password must be at most 72 UTF-8 bytes');
  }
  async register(dto: RegisterDto, device: string | undefined, agent: string) {
    this.passwordValid(dto.password);
    await this.db.atomic(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email.toLowerCase().trim(),
          name: dto.name.trim(),
          password_hash: await bcrypt.hash(dto.password, 12),
          role: 'STUDENT',
          role_id: 'STUDENT',
        },
      });
      await audit(tx, {
        target: user.id,
        action: 'ACCOUNT_REGISTERED',
        description: 'Student account created.',
      });
    });
    return this.login(dto, device, agent);
  }
  private tokens(user: DbUser, sessionId: string) {
    const common = {
      issuer: 'freshman',
      audience: 'freshman-web',
      subject: user.id,
      algorithm: 'HS256' as const,
    };
    return {
      access: jwt.sign({ sid: sessionId }, process.env.JWT_ACCESS_SECRET!, {
        ...common,
        expiresIn: '15m',
      }),
      refresh: jwt.sign(
        { sid: sessionId, jti: randomUUID() },
        process.env.JWT_REFRESH_SECRET!,
        { ...common, expiresIn: '30d' },
      ),
    };
  }
  async login(dto: LoginDto, deviceCookie: string | undefined, agent: string) {
    const found = await this.db.user.findUnique({
      where: { email: dto.email.toLowerCase().trim() },
    });
    const valid = found
      ? await bcrypt.compare(dto.password, found.password_hash)
      : (await bcrypt.hash(dto.password, 12), false);
    if (!found || !valid || !found.active) {
      if (found)
        await audit(this.db, {
          target: found.id,
          action: 'LOGIN_FAILED',
          description: 'Sign-in attempt rejected.',
        });
      throw new UnauthorizedException('Invalid email or password');
    }
    return this.db.atomic(async (tx) => {
      // A row update serializes login, device reset and recovery without raw locking SQL.
      const user = await tx.user.update({
        where: { id: found.id },
        data: { auth_version: { increment: 1 }, last_login_at: new Date() },
      });
      if (!user.active || user.password_hash !== found.password_hash)
        throw new UnauthorizedException('Please try signing in again');
      let deviceId: string | null = null,
        deviceToken = deviceCookie;
      if (user.role === 'STUDENT') {
        const installationHash = dto.installation_id
          ? digest(dto.installation_id)
          : undefined;
        if (deviceToken) {
          const trusted = await tx.studentDevice.findFirst({
            where: { token_hash: digest(deviceToken), revoked_at: null },
          });
          // A browser cookie belongs to one account at a time, not to the
          // browser itself. When accounts are switched, issue a fresh token
          // for the newly authenticated account instead of blocking login.
          if (!trusted || trusted.user_id !== user.id) deviceToken = undefined;
        }

        const active = await tx.studentDevice.findMany({
          where: { user_id: user.id, revoked_at: null },
        });
        const presentedTokenHash = deviceToken
          ? digest(deviceToken)
          : undefined;
        const existing = active.find(
          (device) => device.token_hash === presentedTokenHash,
        );
        const installation = installationHash
          ? active.find(
              (device) => device.installation_hash === installationHash,
            )
          : undefined;
        const currentDevice = existing ?? installation;
        if (currentDevice) {
          const nextToken = existing
            ? deviceToken!
            : randomBytes(32).toString('hex');
          deviceToken = nextToken;
          deviceId = currentDevice.id;
          await tx.studentDevice.update({
            where: { id: currentDevice.id },
            data: {
              last_seen_at: new Date(),
              token_hash: digest(nextToken),
              ...(installationHash
                ? { installation_hash: installationHash }
                : {}),
            },
          });
        } else {
          deviceToken = randomBytes(32).toString('hex');
          const device = await tx.studentDevice.create({
            data: {
              user_id: user.id,
              token_hash: digest(deviceToken),
              installation_hash: installationHash,
              label: agent.slice(0, 200) || 'Registered browser',
            },
          });
          deviceId = device.id;
          await audit(tx, {
            actor: {
              id: user.id,
              name: user.name,
              role: user.role as CurrentUser['role'],
            },
            target: user.id,
            action: 'DEVICE_REGISTERED',
            description: 'Learning browser registered.',
            resourceType: 'DEVICE',
            resourceId: device.id,
          });
        }
      }
      await tx.authSession.updateMany({
        where: {
          user_id: user.id,
          revoked_at: null,
          ...(user.role === 'STUDENT' ? { device_id: deviceId } : {}),
        },
        data: { revoked_at: new Date() },
      });
      const id = randomUUID(),
        tokens = this.tokens(user, id);
      await tx.authSession.create({
        data: {
          id,
          user_id: user.id,
          device_id: deviceId,
          refresh_hash: digest(tokens.refresh),
          expires_at: new Date(Date.now() + 30 * 86400000),
        },
      });
      await audit(tx, {
        actor: {
          id: user.id,
          name: user.name,
          role: user.role as CurrentUser['role'],
        },
        target: user.id,
        action: 'LOGIN_SUCCEEDED',
        description:
          'Signed in successfully; previous sessions on this authorized installation replaced.',
      });
      return { ...tokens, device: deviceToken, user: publicUser(user) };
    });
  }
  googleStart(linkUserId?: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri)
      throw new BadRequestException('Google sign-in is not configured');
    const state = randomBytes(32).toString('hex');
    const nonce = randomBytes(32).toString('hex');
    const client = new OAuth2Client(clientId, clientSecret, redirectUri);
    return {
      state,
      nonce,
      intent: linkUserId ? 'link' : 'login',
      url: client.generateAuthUrl({
        access_type: 'online',
        prompt: 'select_account',
        scope: ['openid', 'email', 'profile'],
        state,
        nonce,
      }),
    };
  }
  async currentGoogleLinkUser(accessToken?: string, deviceCookie?: string) {
    if (!accessToken) return undefined;
    try {
      const claims = jwt.verify(accessToken, process.env.JWT_ACCESS_SECRET!, {
        algorithms: ['HS256'],
        issuer: 'freshman',
        audience: 'freshman-web',
      }) as jwt.JwtPayload;
      const session = await this.db.authSession.findFirst({
        where: {
          id: claims.sid,
          user_id: claims.sub,
          revoked_at: null,
          expires_at: { gt: new Date() },
          user: { active: true },
        },
        include: { studentDevice: true, user: true },
      });
      if (!session) return undefined;
      if (
        session.user.role === 'STUDENT' &&
        (!session.studentDevice ||
          !deviceCookie ||
          session.studentDevice.token_hash !== digest(deviceCookie))
      )
        return undefined;
      return session.user.id;
    } catch {
      return undefined;
    }
  }
  async googleCallback(
    code: string | undefined,
    state: string | undefined,
    expectedState: string | undefined,
    nonce: string | undefined,
    intent: string | undefined,
    deviceCookie: string | undefined,
    agent: string,
    currentUserId?: string,
  ) {
    if (!code || !state || !expectedState || state !== expectedState || !nonce)
      throw new UnauthorizedException('Invalid Google sign-in state');
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI;
    if (!clientId || !clientSecret || !redirectUri)
      throw new BadRequestException('Google sign-in is not configured');
    const client = new OAuth2Client(clientId, clientSecret, redirectUri);
    const { tokens } = await client.getToken(code);
    if (!tokens.id_token)
      throw new UnauthorizedException('Google identity token missing');
    const ticket = await client.verifyIdToken({
      idToken: tokens.id_token,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (
      !payload?.sub ||
      !payload.email ||
      payload.email_verified !== true ||
      !payload.iss ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(
        payload.iss,
      ) ||
      payload.aud !== clientId ||
      (payload.exp ?? 0) <= Math.floor(Date.now() / 1000) ||
      payload.nonce !== nonce
    )
      throw new UnauthorizedException('Invalid Google identity token');
    const providerAccount = await this.db.authProviderAccount.findUnique({
      where: {
        provider_provider_account_id: {
          provider: 'GOOGLE',
          provider_account_id: payload.sub,
        },
      },
      include: { user: true },
    });
    if (intent === 'link') {
      if (!currentUserId)
        throw new UnauthorizedException('Sign in before linking Google');
      if (providerAccount && providerAccount.user_id !== currentUserId)
        throw new ConflictException(
          'This Google account is already linked to another Learnova account',
        );
      const emailUser = await this.db.user.findUnique({
        where: { email: payload.email.toLowerCase() },
      });
      if (emailUser && emailUser.id !== currentUserId)
        throw new ConflictException(
          'This Google email belongs to another Learnova account',
        );
      if (!providerAccount)
        await this.db.authProviderAccount.create({
          data: {
            user_id: currentUserId,
            provider: 'GOOGLE',
            provider_account_id: payload.sub,
            email: payload.email.toLowerCase(),
            email_verified: true,
          },
        });
      return { linked: true };
    }
    if (providerAccount) {
      if (!providerAccount.user.active)
        throw new UnauthorizedException('This account is inactive');
      return this.loginUserById(providerAccount.user.id, deviceCookie, agent);
    }
    const emailUser = await this.db.user.findUnique({
      where: { email: payload.email.toLowerCase() },
    });
    if (emailUser)
      throw new ConflictException(
        'An account with this email already exists. Sign in with your password, then link Google from your profile.',
      );
    const user = await this.db.atomic(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: payload.email!.toLowerCase(),
          name: (payload.name || payload.email!.split('@')[0])
            .trim()
            .slice(0, 100),
          password_hash: await bcrypt.hash(randomBytes(32).toString('hex'), 12),
          role: 'STUDENT',
          role_id: 'STUDENT',
          providerAccounts: {
            create: {
              provider: 'GOOGLE',
              provider_account_id: payload.sub!,
              email: payload.email!.toLowerCase(),
              email_verified: true,
            },
          },
        },
      });
      await audit(tx, {
        target: created.id,
        action: 'ACCOUNT_REGISTERED',
        description: 'Student account created with Google.',
      });
      return created;
    });
    return this.loginUserById(user.id, deviceCookie, agent);
  }
  private async loginUserById(
    userId: string,
    deviceCookie: string | undefined,
    agent: string,
  ) {
    const found = await this.db.user.findUnique({ where: { id: userId } });
    if (!found || !found.active)
      throw new UnauthorizedException('This account is inactive');
    return this.db.atomic(async (tx) => {
      const user = await tx.user.update({
        where: { id: found.id },
        data: { auth_version: { increment: 1 }, last_login_at: new Date() },
      });
      let deviceId: string | null = null,
        deviceToken = deviceCookie;
      if (user.role === 'STUDENT') {
        if (deviceToken) {
          const trusted = await tx.studentDevice.findFirst({
            where: { token_hash: digest(deviceToken), revoked_at: null },
          });
          if (!trusted || trusted.user_id !== user.id) deviceToken = undefined;
        }
        const active = await tx.studentDevice.findMany({
          where: { user_id: user.id, revoked_at: null },
        });
        const existing = active.find(
          (device) =>
            device.token_hash ===
            (deviceToken ? digest(deviceToken) : undefined),
        );
        const currentDevice = existing;
        if (currentDevice) {
          const nextToken = deviceToken!;
          deviceToken = nextToken;
          deviceId = currentDevice.id;
          await tx.studentDevice.update({
            where: { id: currentDevice.id },
            data: { last_seen_at: new Date(), token_hash: digest(nextToken) },
          });
        } else {
          deviceToken = randomBytes(32).toString('hex');
          const device = await tx.studentDevice.create({
            data: {
              user_id: user.id,
              token_hash: digest(deviceToken),
              label: agent.slice(0, 200) || 'Registered browser',
            },
          });
          deviceId = device.id;
          await audit(tx, {
            actor: {
              id: user.id,
              name: user.name,
              role: user.role as CurrentUser['role'],
            },
            target: user.id,
            action: 'DEVICE_REGISTERED',
            description: 'Learning browser registered.',
            resourceType: 'DEVICE',
            resourceId: device.id,
          });
        }
      }
      await tx.authSession.updateMany({
        where: {
          user_id: user.id,
          revoked_at: null,
          ...(user.role === 'STUDENT' ? { device_id: deviceId } : {}),
        },
        data: { revoked_at: new Date() },
      });
      const id = randomUUID(),
        tokens = this.tokens(user, id);
      await tx.authSession.create({
        data: {
          id,
          user_id: user.id,
          device_id: deviceId,
          refresh_hash: digest(tokens.refresh),
          expires_at: new Date(Date.now() + 30 * 86400000),
        },
      });
      await audit(tx, {
        actor: {
          id: user.id,
          name: user.name,
          role: user.role as CurrentUser['role'],
        },
        target: user.id,
        action: 'LOGIN_SUCCEEDED',
        description: 'Signed in successfully with Google.',
      });
      return { ...tokens, device: deviceToken, user: publicUser(user) };
    });
  }
  async refresh(token?: string, deviceCookie?: string) {
    if (!token) throw new UnauthorizedException('Refresh session missing');
    let claims: jwt.JwtPayload;
    try {
      claims = jwt.verify(token, process.env.JWT_REFRESH_SECRET!, {
        algorithms: ['HS256'],
        issuer: 'freshman',
        audience: 'freshman-web',
      }) as jwt.JwtPayload;
    } catch {
      throw new UnauthorizedException('Refresh session expired');
    }
    const result = await this.db.atomic(async (tx) => {
      const session = await tx.authSession.findFirst({
        where: { id: claims.sid, user_id: claims.sub },
        include: { user: true, studentDevice: true },
      });
      if (!session || session.revoked_at || session.expires_at <= new Date())
        return null;
      if (session.refresh_hash !== digest(token)) {
        await tx.authSession.update({
          where: { id: session.id },
          data: { revoked_at: new Date() },
        });
        return null;
      }
      const user = session.user,
        device = session.studentDevice;
      if (
        !user.active ||
        (user.role === 'STUDENT' &&
          (!deviceCookie ||
            !device ||
            device.revoked_at ||
            device.token_hash !== digest(deviceCookie)))
      )
        return null;
      const tokens = this.tokens(user, session.id);
      await tx.authSession.update({
        where: { id: session.id },
        data: { refresh_hash: digest(tokens.refresh) },
      });
      if (device)
        await tx.studentDevice.update({
          where: { id: device.id },
          data: { last_seen_at: new Date() },
        });
      return { ...tokens, user: publicUser(user) };
    });
    if (!result)
      throw new UnauthorizedException('Session revoked. Please sign in again.');
    return result;
  }
  async logout(user: CurrentUser) {
    await this.db.atomic(async (tx) => {
      await tx.authSession.update({
        where: { id: user.sessionId },
        data: { revoked_at: new Date() },
      });
      await audit(tx, {
        actor: user,
        target: user.id,
        action: 'LOGOUT',
        description: 'Signed out; session revoked.',
      });
    });
  }
  async forgot(email: string) {
    this.mail.requireConfiguration();
    const user = await this.db.user.findFirst({
      where: { email: email.toLowerCase().trim(), active: true },
    });
    if (user) {
      const token = randomBytes(32).toString('hex');
      await this.db.atomic(async (tx) => {
        await tx.passwordResetToken.updateMany({
          where: { user_id: user.id, consumed_at: null },
          data: { consumed_at: new Date() },
        });
        await tx.passwordResetToken.create({
          data: {
            user_id: user.id,
            token_hash: digest(token),
            expires_at: new Date(Date.now() + 15 * 60000),
          },
        });
      });
      await this.mail.sendReset(email, token);
    }
    return {
      message:
        'If an account exists, password recovery instructions have been sent.',
    };
  }
  async reset(dto: ResetDto) {
    this.passwordValid(dto.password);
    const hash = await bcrypt.hash(dto.password, 12);
    await this.db.atomic(async (tx) => {
      const now = new Date();
      const reset = await tx.passwordResetToken.findFirst({
        where: {
          token_hash: digest(dto.token),
          consumed_at: null,
          expires_at: { gt: now },
        },
      });
      if (!reset)
        throw new BadRequestException('Invalid or expired recovery link');
      // Claim the row conditionally. This makes two concurrent submissions
      // with the same token mutually exclusive inside the database.
      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: reset.id,
          consumed_at: null,
          expires_at: { gt: now },
        },
        data: { consumed_at: now },
      });
      if (claimed.count !== 1)
        throw new BadRequestException('Invalid or expired recovery link');
      await tx.user.update({
        where: { id: reset.user_id },
        data: { password_hash: hash, auth_version: { increment: 1 } },
      });
      await tx.passwordResetToken.updateMany({
        where: { user_id: reset.user_id, consumed_at: null },
        data: { consumed_at: now },
      });
      await tx.authSession.updateMany({
        where: { user_id: reset.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await tx.studentDevice.updateMany({
        where: { user_id: reset.user_id, revoked_at: null },
        data: { revoked_at: new Date() },
      });
      await audit(tx, {
        target: reset.user_id,
        action: 'PASSWORD_RECOVERY',
        description:
          'Password recovered; device registration and sessions revoked.',
      });
    });
    return {
      message: 'Password reset. Sign in to register your current browser.',
    };
  }
  async validateReset(token: string) {
    if (!token)
      throw new BadRequestException('Invalid or expired recovery link');
    const reset = await this.db.passwordResetToken.findFirst({
      where: {
        token_hash: digest(token),
        consumed_at: null,
        expires_at: { gt: new Date() },
      },
      select: { id: true },
    });
    if (!reset)
      throw new BadRequestException('Invalid or expired recovery link');
    return { valid: true };
  }
  profile(user: CurrentUser, name: string) {
    return this.db.atomic(async (tx) => {
      const result = await tx.user.update({
        where: { id: user.id },
        data: { name: name.trim() },
        select: { id: true, email: true, name: true, role: true },
      });
      await audit(tx, {
        actor: user,
        target: user.id,
        action: 'PROFILE_UPDATED',
        description: 'Profile name updated.',
        oldValues: { name: user.name },
        newValues: { name: result.name },
      });
      return result;
    });
  }
}
