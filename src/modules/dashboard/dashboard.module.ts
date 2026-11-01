import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
@Controller('dashboard')
class DashboardController {
  constructor(private readonly db: PrismaService) {}
  @Get() async summary(@User() u: CurrentUser) {
    if (['ADMIN', 'SUPER_ADMIN'].includes(u.role)) {
      const [users, students, active_students, suspended_students, instructors, courses, published_courses, enrollments, pending_payments, verified_payments, revenue, recent] = await this.db.$transaction([
        this.db.user.count(),
        this.db.user.count({ where: { role: 'STUDENT' } }),
        this.db.user.count({ where: { role: 'STUDENT', active: true, suspended: false } }),
        this.db.user.count({ where: { role: 'STUDENT', suspended: true } }),
        this.db.user.count({ where: { role: 'INSTRUCTOR' } }),
        this.db.course.count(),
        this.db.course.count({ where: { published: true } }),
        this.db.enrollment.count(),
        this.db.payment.count({ where: { status: 'PENDING' } }),
        this.db.payment.count({ where: { status: 'SUCCEEDED' } }),
        this.db.payment.groupBy({ by: ['currency'], where: { status: 'SUCCEEDED' }, _sum: { amount_minor: true } }),
        this.db.auditLog.findMany({ where: { OR: [{ actor_role: { in: ['ADMIN', 'SUPER_ADMIN'] } }, { actor_role: null, actor: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } } }] }, select: { id: true, action: true, description: true, actor_name: true, actor_role: true, target_id: true, created_at: true, actor: { select: { name: true, role: true } } }, orderBy: [{ created_at: 'desc' }, { id: 'desc' }], take: 10 }),
      ]);
      return { role: u.role,
        metrics: { users, students, active_students, inactive_students: students - active_students - suspended_students, suspended_students, instructors, courses, published_courses, enrollments, pending_payments, verified_payments },
        revenue: revenue.map(r => ({ currency: r.currency, amount_minor: r._sum.amount_minor ?? 0 })), recent,
      };
    }
    if (u.role === 'INSTRUCTOR') {
      const [courses, published_courses, quizzes, lessons, enrollments, pending_submissions] = await this.db.$transaction([
        this.db.course.count({ where: { instructor_id: u.id } }),
        this.db.course.count({ where: { instructor_id: u.id, published: true, archived_at: null } }),
        this.db.lesson.count({ where: { course: { instructor_id: u.id }, kind: 'QUIZ' } }),
        this.db.lesson.count({ where: { course: { instructor_id: u.id } } }),
        this.db.enrollment.count({
          where: {
            course: { instructor_id: u.id },
            status: 'ACTIVE',
            entitlement: { state: 'ACTIVE' },
          },
        }),
        this.db.assessmentSubmission.count({ where: { reviewed_at: null, assessment: { course: { instructor_id: u.id } } } }),
      ]);
      const [recentEnrollments, recentProgress] = await Promise.all([
        this.db.enrollment.findMany({ where: { course: { instructor_id: u.id }, status: 'ACTIVE', entitlement: { state: 'ACTIVE' } }, select: { created_at: true, user: { select: { name: true } }, course: { select: { title: true } } }, orderBy: { created_at: 'desc' }, take: 5 }),
        this.db.learningProgress.findMany({ where: { lesson: { course: { instructor_id: u.id } } }, select: { completed_at: true, lesson: { select: { title: true } } }, orderBy: { completed_at: 'desc' }, take: 5 }),
      ]);
      const recent = [
        ...recentEnrollments.map(e => ({ action: 'enrolled in ' + e.course.title, reason: e.user.name, created_at: e.created_at })),
        ...recentProgress.map(p => ({ action: 'completed ' + p.lesson.title, reason: null, created_at: p.completed_at })),
      ].sort((a, b) => b.created_at.getTime() - a.created_at.getTime()).slice(0, 5);
      return {
        role: u.role,
        metrics: { courses, published_courses, quizzes, lessons, enrollments, pending_submissions },
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
