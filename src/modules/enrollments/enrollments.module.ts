import { notify } from '../notifications/notifications.js';
import {
  Controller,
  ForbiddenException,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { audit } from '../audit/audit.js';
import { PrismaService } from '../../prisma/prisma.service.js';
@Controller('enrollments')
class EnrollmentsController {
  constructor(private readonly db: PrismaService) {}
  @Get('me') async mine(@User() u: CurrentUser) {
    const rows = await this.db.enrollment.findMany({
      where: {
        user_id: u.id,
        status: 'ACTIVE',
        entitlement: { state: 'ACTIVE' },
        OR: [{ payment_id: null }, { payment: { status: 'SUCCEEDED' } }],
      },
      include: {
        course: {
          include: {
            _count: { select: { lessons: true } },
            lessons: {
              select: {
                _count: { select: { progress: { where: { user_id: u.id } } } },
              },
            },
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(({ course, status, created_at }) => {
      const { _count, lessons, ...safe } = course;
      return {
        ...safe,
        status,
        enrolled_at: created_at,
        lesson_count: _count.lessons,
        completed_count: lessons.reduce((sum, l) => sum + l._count.progress, 0),
      };
    });
  }
  @Post(':id/free') async free(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (u.role !== 'STUDENT')
      throw new ForbiddenException('Student account required');
    return this.db.atomic(async (tx) => {
      const course = await tx.course.findUnique({ where: { id } });
      if (
        !course?.published ||
        course.archived_at ||
        course.visibility !== 'PUBLIC' ||
        course.price_minor !== 0
      )
        throw new ForbiddenException('This course requires verified payment');
      const existing = await tx.enrollment.findUnique({
        where: { user_id_course_id: { user_id: u.id, course_id: id } },
        include: { entitlement: true },
      });
      if (
        existing?.status === 'REVOKED' ||
        existing?.entitlement?.state === 'REVOKED'
      )
        throw new ForbiddenException('Enrollment revoked; contact support');
      const enrollment = await tx.enrollment.upsert({
        where: { user_id_course_id: { user_id: u.id, course_id: id } },
        update: {},
        create: { user_id: u.id, course_id: id },
      });
      await tx.courseEntitlement.upsert({
        where: { enrollment_id: enrollment.id },
        update: {},
        create: { enrollment_id: enrollment.id },
      });
      if (!existing)
        await audit(tx, {
          actor: u,
          target: u.id,
          action: 'COURSE_ENROLLED',
          description: `Enrolled in free course: ${course.title}.`,
          resourceType: 'COURSE',
          resourceId: id,
        });
      await notify(tx, [u.id], { event_key: `enrolled:${enrollment.id}`, kind: 'ENROLLMENT', title: "You're enrolled", message: `Start learning: ${course.title}`, href: `/learn/${id}`, course_id: id });
      return { access: true };
    });
  }
}
@Module({ controllers: [EnrollmentsController] })
export class EnrollmentsModule {}
