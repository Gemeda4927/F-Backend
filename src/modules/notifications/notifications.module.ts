import { PushWorker } from './push.worker.js';
import {
  Body,
  Controller,
  ConflictException,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CoursesService } from '../courses/courses.service.js';
import { notify, notifyCourse } from './notifications.js';
import { randomUUID } from 'node:crypto';

class AnnouncementDto {
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsString() @MinLength(3) @MaxLength(2000) message!: string;
}
class InboxQuery {
  @IsOptional() @IsIn(['true', 'false']) unread?: string;
  @IsOptional() @IsUUID() cursor?: string;
}
// Re-check the current entitlement rather than trusting access at delivery time.
export function notificationScope(
  u: CurrentUser,
): Prisma.NotificationWhereInput {
  return {
    user_id: u.id,
    OR: [
      { course_id: null },
      {
        course: ['ADMIN', 'SUPER_ADMIN'].includes(u.role)
          ? {}
          : {
              OR: [
                { instructor_id: u.id },
                {
                  published: true,
                  enrollments: {
                    some: {
                      user_id: u.id,
                      status: 'ACTIVE',
                      entitlement: { state: 'ACTIVE' },
                      OR: [
                        { payment_id: null },
                        { payment: { status: 'SUCCEEDED' } },
                      ],
                    },
                  },
                },
              ],
            },
      },
    ],
  };
}
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly db: PrismaService,
    private readonly courses: CoursesService,
  ) {}
  private async deadlines(u: CurrentUser) {
    if (u.role !== 'STUDENT') return;
    const upcoming = await this.db.assessment.findMany({
      where: {
        published: true,
        due_at: { gt: new Date(), lte: new Date(Date.now() + 86400000) },
        submissions: { none: { student_id: u.id } },
        course: {
          published: true,
          enrollments: {
            some: {
              user_id: u.id,
              status: 'ACTIVE',
              entitlement: { state: 'ACTIVE' },
              OR: [{ payment_id: null }, { payment: { status: 'SUCCEEDED' } }],
            },
          },
        },
      },
      take: 50,
    });
    await this.db.notification.createMany({
      data: upcoming.map((a) => ({
        user_id: u.id,
        course_id: a.course_id,
        event_key: `deadline:${a.id}:${a.due_at!.toISOString()}`,
        kind: 'DEADLINE',
        title: `Due soon: ${a.title}`,
        message: `Submit before ${a.due_at!.toISOString()}.`,
        href: `/learn/${a.course_id}/activities/${a.id}?type=assessment`,
      })),
      skipDuplicates: true,
    });
  }
  @Get() async list(@User() u: CurrentUser, @Query() query: InboxQuery) {
    await this.deadlines(u);
    const where = notificationScope(u);
    const [items, unread] = await Promise.all([
      this.db.notification.findMany({
        where:
          query.unread === 'true' ? { AND: [where, { read_at: null }] } : where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: 51,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
      this.db.notification.count({
        where: { AND: [where, { read_at: null }] },
      }),
    ]);
    return {
      items: items.slice(0, 50),
      unread,
      next_cursor: items.length > 50 ? items[49].id : null,
    };
  }
  @Patch('read-all') async readAll(@User() u: CurrentUser) {
    return this.db.notification.updateMany({
      where: { AND: [notificationScope(u), { read_at: null }] },
      data: { read_at: new Date() },
    });
  }
  @Patch(':id/read') async read(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.db.notification.updateMany({
      where: { AND: [notificationScope(u), { id, read_at: null }] },
      data: { read_at: new Date() },
    });
    if (
      !result.count &&
      !(await this.db.notification.findFirst({
        where: { AND: [notificationScope(u), { id }] },
      }))
    )
      throw new NotFoundException('Notification not found');
    return { read: true };
  }
  @Permissions('courses:write') @Post('course/:courseId') async announce(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: AnnouncementDto,
  ) {
    const course = await this.courses.assertOwner(u, courseId);
    if (!course.published)
      throw new ConflictException(
        'Publish this course before sending announcements',
      );
    const delivered = await this.db.atomic((tx) =>
      notifyCourse(tx, courseId, {
        title: dto.title,
        message: dto.message,
        kind: 'ANNOUNCEMENT',
        event_key: `announcement:${randomUUID()}`,
        href: `/learn/${courseId}?tab=overview`,
      }),
    );
    return { recipients: delivered.count };
  }
  @Permissions('users:manage') @Post('system') async system(
    @User() _u: CurrentUser,
    @Body() dto: AnnouncementDto,
  ) {
    const users = await this.db.user.findMany({
      where: { active: true, suspended: false },
      select: { id: true },
    });
    const event_key = `system:${randomUUID()}`;
    const delivered = await this.db.atomic((tx) =>
      notify(
        tx,
        users.map((x) => x.id),
        {
          title: dto.title,
          message: dto.message,
          kind: 'SYSTEM',
          event_key,
          href: '/notifications',
        },
      ),
    );
    return { recipients: delivered.count };
  }
}
@Module({ imports: [CoursesModule], controllers: [NotificationsController], providers: [PushWorker] })
export class NotificationsModule {}
