import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import {
  initializeApp,
  getApps,
  cert,
  applicationDefault,
} from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { PrismaService } from '../../prisma/prisma.service.js';
import { decryptPushToken } from '../devices/push-token.js';
@Injectable()
export class PushWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private timer?: ReturnType<typeof setInterval>;
  private busy = false;
  private readonly log = new Logger(PushWorker.name);
  constructor(private readonly db: PrismaService) {}
  onApplicationBootstrap() {
    if (process.env.FIREBASE_PUSH_ENABLED !== 'true') return;
    this.timer = setInterval(() => {
      void this.deliver();
    }, 30000);
    this.timer.unref();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
  async deliver() {
    if (this.busy) return;
    this.busy = true;
    try {
      const app =
        getApps().find((a) => a.name === 'learnova-push') ??
        initializeApp(
          {
            projectId: process.env.FIREBASE_PROJECT_ID,
            credential: process.env.FIREBASE_SERVICE_ACCOUNT_JSON
              ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON))
              : applicationDefault(),
          },
          'learnova-push',
        );
      const cutoff = new Date(Date.now() - 86400000),
        lease = new Date(Date.now() - 120000);
      const notices = await this.db.notification.findMany({
        where: {
          push_delivered_at: null,
          push_attempts: { lt: 3 },
          created_at: { gte: cutoff },
          OR: [{ push_claimed_at: null }, { push_claimed_at: { lt: lease } }],
        },
        orderBy: { created_at: 'asc' },
        take: 30,
      });
      for (const notice of notices) {
        const claim = await this.db.notification.updateMany({
          where: {
            id: notice.id,
            push_delivered_at: null,
            OR: [{ push_claimed_at: null }, { push_claimed_at: { lt: lease } }],
          },
          data: {
            push_claimed_at: new Date(),
            push_attempts: { increment: 1 },
          },
        });
        if (!claim.count) continue;
        const user = await this.db.user.findUnique({
          where: { id: notice.user_id },
        });
        let allowed = !!user?.active && !user.suspended;
        if (allowed && notice.course_id)
          allowed = !!(await this.db.course.count({
            where: {
              id: notice.course_id,
              published: true,
              enrollments: {
                some: {
                  user_id: notice.user_id,
                  status: 'ACTIVE',
                  entitlement: { state: 'ACTIVE' },
                  OR: [
                    { payment_id: null },
                    { payment: { status: 'SUCCEEDED' } },
                  ],
                },
              },
            },
          }));
        const devices = allowed
          ? await this.db.studentDevice.findMany({
              where: {
                user_id: notice.user_id,
                revoked_at: null,
                fcm_token_encrypted: { not: null },
                sessions: {
                  some: { revoked_at: null, expires_at: { gt: new Date() } },
                },
              },
            })
          : [];
        let retry = false;
        for (const device of devices) {
          try {
            await getMessaging(app).send({
              token: decryptPushToken(device.fcm_token_encrypted!),
              data: { notification_id: notice.id, href: '/notifications' },
              webpush: { headers: { TTL: '300' } },
            });
          } catch (error) {
            const code = (error as { code?: string }).code;
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            )
              await this.db.studentDevice.updateMany({
                where: { id: device.id, fcm_token_hash: device.fcm_token_hash },
                data: {
                  fcm_token_encrypted: null,
                  fcm_token_hash: null,
                  push_updated_at: null,
                },
              });
            else retry = true;
          }
        }
        await this.db.notification.update({
          where: { id: notice.id },
          data: {
            push_claimed_at: null,
            ...(retry ? {} : { push_delivered_at: new Date() }),
          },
        });
      }
    } catch {
      this.log.warn(
        'Push delivery unavailable; in-app notifications remain available. Check backend Firebase configuration.',
      );
    } finally {
      this.busy = false;
    }
  }
}
