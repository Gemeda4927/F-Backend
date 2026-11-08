import { Prisma } from '../../generated/prisma/client.js';
import { Controller, Get, Module, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
@Controller('dashboard')
class DashboardController {
  constructor(private readonly db: PrismaService) {}
  @Get() async summary(
    @User() u: CurrentUser,
    @Query('days') requestedDays?: string,
  ) {
    if (['ADMIN', 'SUPER_ADMIN'].includes(u.role)) {
      const financial =
        u.role === 'SUPER_ADMIN' || u.permissions?.includes('payments:review');
      const [
        users,
        students,
        active_students,
        suspended_students,
        instructors,
        courses,
        published_courses,
        enrollments,
        pending_payments,
        verified_payments,
        revenue,
        recent,
        paid_courses,
        free_courses,
        active_sessions,
        active_enrollments,
        draft_courses,
      ] = await this.db.$transaction([
        this.db.user.count(),
        this.db.user.count({ where: { role: 'STUDENT' } }),
        this.db.user.count({
          where: { role: 'STUDENT', active: true, suspended: false },
        }),
        this.db.user.count({ where: { role: 'STUDENT', suspended: true } }),
        this.db.user.count({ where: { role: 'INSTRUCTOR' } }),
        this.db.course.count(),
        this.db.course.count({ where: { published: true, archived_at: null } }),
        this.db.enrollment.count(),
        this.db.payment.count({
          where: {
            status: 'PENDING',
            ...(!financial ? { id: { in: [] } } : {}),
          },
        }),
        this.db.payment.count({
          where: {
            status: 'SUCCEEDED',
            ...(!financial ? { id: { in: [] } } : {}),
          },
        }),
        this.db.payment.groupBy({
          by: ['currency'],
          where: {
            status: 'SUCCEEDED',
            mode: 'live',
            ...(!financial ? { id: { in: [] } } : {}),
          },
          _sum: { amount_minor: true },
        }),
        this.db.auditLog.findMany({
          where: u.role === 'SUPER_ADMIN' ? {} : { actor_id: u.id },
          select: {
            id: true,
            action: true,
            description: true,
            actor_name: true,
            actor_role: true,
            target_id: true,
            created_at: true,
            actor: { select: { name: true, role: true } },
          },
          orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
          take: 10,
        }),
        this.db.course.count({
          where: { archived_at: null, price_minor: { gt: 0 } },
        }),
        this.db.course.count({ where: { archived_at: null, price_minor: 0 } }),
        this.db.authSession.count({
          where: { revoked_at: null, expires_at: { gt: new Date() } },
        }),
        this.db.enrollment.count({
          where: { status: 'ACTIVE', entitlement: { state: 'ACTIVE' } },
        }),
        this.db.course.count({
          where: { published: false, archived_at: null },
        }),
      ]);
      const days = ['7', '30', '90'].includes(requestedDays ?? '')
        ? Number(requestedDays)
        : 30;
      const since = new Date();
      since.setUTCHours(0, 0, 0, 0);
      since.setUTCDate(since.getUTCDate() - days + 1);
      const [
        registrations,
        enrollment_trend,
        publications,
        revenue_trend,
        popular_courses,
        instructor_activity,
      ] = await Promise.all([
        this.db.$queryRaw<{ day: Date; count: number }[]>(
          Prisma.sql`SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count FROM users WHERE role = 'STUDENT' AND created_at >= ${since} GROUP BY 1 ORDER BY 1`,
        ),
        this.db.$queryRaw<{ day: Date; count: number }[]>(
          Prisma.sql`SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count FROM enrollments WHERE created_at >= ${since} GROUP BY 1 ORDER BY 1`,
        ),
        this.db.$queryRaw<{ day: Date; count: number }[]>(
          Prisma.sql`SELECT date_trunc('day', created_at)::date AS day, count(*)::int AS count FROM audit_logs WHERE action = 'COURSE_PUBLISHED' AND created_at >= ${since} GROUP BY 1 ORDER BY 1`,
        ),
        this.db.$queryRaw<{ day: Date; currency: string; count: number }[]>(
          Prisma.sql`SELECT date_trunc('day', verified_at)::date AS day, currency, sum(amount_minor)::float8 / 100 AS count FROM payments WHERE mode = 'live' AND status = 'SUCCEEDED' AND verified_at >= ${since} AND ${Boolean(financial)} GROUP BY 1, 2 ORDER BY 1, 2`,
        ),
        this.db.$queryRaw<{ name: string; count: number }[]>(
          Prisma.sql`SELECT c.title AS name, count(e.id)::int AS count FROM courses c JOIN enrollments e ON e.course_id = c.id JOIN course_entitlements ce ON ce.enrollment_id = e.id WHERE e.status = 'ACTIVE' AND ce.state = 'ACTIVE' AND (e.payment_id IS NULL OR EXISTS (SELECT 1 FROM payments p WHERE p.id=e.payment_id AND p.status='SUCCEEDED')) GROUP BY c.id, c.title ORDER BY count DESC, c.id LIMIT 5`,
        ),
        this.db.$queryRaw<{ name: string; count: number }[]>(
          Prisma.sql`SELECT coalesce(max(actor_name),'Instructor') AS name, count(*)::int AS count FROM audit_logs WHERE actor_role = 'INSTRUCTOR' AND action IN ('COURSE_PUBLISHED','COURSE_UNPUBLISHED') AND created_at >= ${since} GROUP BY actor_id ORDER BY count DESC, actor_id LIMIT 5`,
        ),
      ]);
      return {
        role: u.role,
        analytics: {
          days,
          registrations,
          enrollment_trend,
          publications,
          revenue_trend,
          popular_courses,
          instructor_activity,
        },
        metrics: {
          paid_courses,
          free_courses,
          active_sessions,
          active_enrollments,
          draft_courses,
          users,
          students,
          active_students,
          inactive_students: students - active_students - suspended_students,
          suspended_students,
          instructors,
          courses,
          published_courses,
          enrollments,
          pending_payments,
          verified_payments,
        },
        revenue: revenue.map((r) => ({
          currency: r.currency,
          amount_minor: r._sum.amount_minor ?? 0,
        })),
        recent,
      };
    }
    if (u.role === 'INSTRUCTOR') {
      const [
        courses,
        published_courses,
        quizzes,
        lessons,
        enrollments,
        pending_submissions,
      ] = await this.db.$transaction([
        this.db.course.count({ where: { instructor_id: u.id } }),
        this.db.course.count({
          where: { instructor_id: u.id, published: true, archived_at: null },
        }),
        this.db.lesson.count({
          where: { course: { instructor_id: u.id }, kind: 'QUIZ' },
        }),
        this.db.lesson.count({ where: { course: { instructor_id: u.id } } }),
        this.db.enrollment.count({
          where: {
            course: { instructor_id: u.id },
            status: 'ACTIVE',
            entitlement: { state: 'ACTIVE' },
          },
        }),
        this.db.assessmentSubmission.count({
          where: {
            reviewed_at: null,
            assessment: { course: { instructor_id: u.id } },
          },
        }),
      ]);
      const [recentEnrollments, recentProgress] = await Promise.all([
        this.db.enrollment.findMany({
          where: {
            course: { instructor_id: u.id },
            status: 'ACTIVE',
            entitlement: { state: 'ACTIVE' },
          },
          select: {
            created_at: true,
            user: { select: { name: true } },
            course: { select: { title: true } },
          },
          orderBy: { created_at: 'desc' },
          take: 5,
        }),
        this.db.learningProgress.findMany({
          where: { lesson: { course: { instructor_id: u.id } } },
          select: { completed_at: true, lesson: { select: { title: true } } },
          orderBy: { completed_at: 'desc' },
          take: 5,
        }),
      ]);
      const recent = [
        ...recentEnrollments.map((e) => ({
          action: 'enrolled in ' + e.course.title,
          reason: e.user.name,
          created_at: e.created_at,
        })),
        ...recentProgress.map((p) => ({
          action: 'completed ' + p.lesson.title,
          reason: null,
          created_at: p.completed_at,
        })),
      ]
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, 5);
      return {
        role: u.role,
        metrics: {
          courses,
          published_courses,
          quizzes,
          lessons,
          enrollments,
          pending_submissions,
        },
        recent,
      };
    }
    const [courses, completed_lessons, pending_payments] =
      await this.db.$transaction([
        this.db.enrollment.count({
          where: {
            user_id: u.id,
            status: 'ACTIVE',
            entitlement: { state: 'ACTIVE' },
          },
        }),
        this.db.learningProgress.count({ where: { user_id: u.id } }),
        this.db.payment.count({ where: { user_id: u.id, status: 'PENDING' } }),
      ]);
    return {
      role: u.role,
      metrics: { courses, completed_lessons, pending_payments },
      recent: [],
    };
  }
}
@Module({ controllers: [DashboardController] })
export class DashboardModule {}
