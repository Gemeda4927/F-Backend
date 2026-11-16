import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';

const SESSION_MINUTES = 30;
const positiveInt = (value: string | undefined, fallback: number, max: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), max) : fallback;
};

@Injectable()
export class CourseAnalyticsService {
  constructor(private readonly db: PrismaService) {}

  async recordView(user: CurrentUser, courseId: string) {
    if (user.role !== 'STUDENT') return { recorded: false, reason: 'Only student views are tracked.' };
    const course = await this.db.course.findFirst({ where: { id: courseId, published: true, archived_at: null, visibility: 'PUBLIC' }, select: { id: true } });
    if (!course) throw new NotFoundException('Course not found');
    const bucket = Math.floor(Date.now() / (SESSION_MINUTES * 60_000));
    const sessionKey = `${courseId}:${user.id}:${bucket}`;
    const now = new Date();
    await this.db.courseView.upsert({ where: { session_key: sessionKey }, create: { course_id: courseId, student_id: user.id, session_key: sessionKey, opened_at: now, last_seen_at: now }, update: { last_seen_at: now } });
    return { recorded: true, deduplication_minutes: SESSION_MINUTES };
  }

  private assertAdmin(user: CurrentUser) { if (user.role !== 'SUPER_ADMIN') throw new ForbiddenException('Super Admin access required'); }

  async listCourses(user: CurrentUser, search: string) {
    this.assertAdmin(user);
    const trimmed = search.trim().slice(0, 120);
    const courses = await this.db.course.findMany({ where: trimmed ? { OR: [{ title: { contains: trimmed, mode: 'insensitive' } }, { category: { contains: trimmed, mode: 'insensitive' } }, { instructor: { name: { contains: trimmed, mode: 'insensitive' } } }] } : {}, orderBy: { created_at: 'desc' }, include: { instructor: { select: { name: true } }, _count: { select: { enrollments: { where: { status: 'ACTIVE', entitlement: { state: 'ACTIVE' } } } } }, thumbnail: { select: { course_id: true } } } });
    const ids = courses.map((course) => course.id);
    const stats = ids.length ? await this.db.$queryRaw<{ course_id: string; total_views: bigint; unique_students: bigint; last_viewed: Date | null }[]>(Prisma.sql`SELECT cv.course_id, COUNT(*)::bigint AS total_views, COUNT(DISTINCT cv.student_id)::bigint AS unique_students, MAX(cv.opened_at) AS last_viewed FROM course_views cv WHERE cv.course_id IN (${Prisma.join(ids)}) GROUP BY cv.course_id`) : [];
    const byId = new Map(stats.map((row) => [row.course_id, row]));
    return courses.map(({ instructor, thumbnail, _count, ...course }) => { const row = byId.get(course.id); return { ...course, instructor_name: instructor.name, has_thumbnail: !!thumbnail, enrolled_students: _count.enrollments, total_views: Number(row?.total_views ?? 0), unique_students: Number(row?.unique_students ?? 0), last_viewed: row?.last_viewed ?? null }; });
  }

  async courseAnalytics(user: CurrentUser, id: string, requestedDays?: string) {
    this.assertAdmin(user);
    const course = await this.db.course.findUnique({ where: { id }, select: { id: true, title: true, category: true, instructor: { select: { name: true } } } });
    if (!course) throw new NotFoundException('Course not found');
    const days = [7, 30, 90].includes(Number(requestedDays)) ? Number(requestedDays) : 30;
    const now = new Date(); const today = new Date(now); today.setUTCHours(0, 0, 0, 0); const week = new Date(today); week.setUTCDate(week.getUTCDate() - 6); const month = new Date(today); month.setUTCDate(month.getUTCDate() - 29); const since = new Date(today); since.setUTCDate(since.getUTCDate() - days + 1);
    const [total, unique, enrolled, todayCount, weekCount, monthCount, trend] = await this.db.$transaction([
      this.db.courseView.count({ where: { course_id: id } }),
      this.db.courseView.findMany({ where: { course_id: id }, distinct: ['student_id'], select: { student_id: true } }),
      this.db.enrollment.count({ where: { course_id: id, status: 'ACTIVE', entitlement: { state: 'ACTIVE' } } }),
      this.db.courseView.count({ where: { course_id: id, opened_at: { gte: today } } }),
      this.db.courseView.count({ where: { course_id: id, opened_at: { gte: week } } }),
      this.db.courseView.count({ where: { course_id: id, opened_at: { gte: month } } }),
      this.db.$queryRaw<{ day: Date; views: bigint; students: bigint }[]>(Prisma.sql`SELECT date_trunc('day', opened_at)::date AS day, COUNT(*)::bigint AS views, COUNT(DISTINCT student_id)::bigint AS students FROM course_views WHERE course_id = ${id} AND opened_at >= ${since} GROUP BY 1 ORDER BY 1`),
    ]);
    return { course, days, total_views: total, unique_students: unique.length, enrolled_students: enrolled, views_today: todayCount, views_this_week: weekCount, views_this_month: monthCount, trend: trend.map((row) => ({ day: row.day, views: Number(row.views), students: Number(row.students) })) };
  }

  async viewers(user: CurrentUser, courseId: string, query: { page?: string; pageSize?: string; search?: string; enrolled?: string; sort?: string }) {
    this.assertAdmin(user);
    const page = positiveInt(query.page, 1, 100000); const pageSize = positiveInt(query.pageSize, 25, 100); const offset = (page - 1) * pageSize; const search = `%${(query.search ?? '').trim().slice(0, 100)}%`; const enrolled = query.enrolled === 'true' ? Prisma.sql`AND EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.course_id = cv.course_id AND e.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM course_entitlements ce WHERE ce.enrollment_id = e.id AND ce.state = 'ACTIVE'))` : query.enrolled === 'false' ? Prisma.sql`AND NOT EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.course_id = cv.course_id AND e.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM course_entitlements ce WHERE ce.enrollment_id = e.id AND ce.state = 'ACTIVE'))` : Prisma.empty;
    const order = query.sort === 'name' ? Prisma.sql`u.name ASC, u.id` : query.sort === 'views' ? Prisma.sql`view_count DESC, last_viewed DESC` : Prisma.sql`last_viewed DESC, u.id`;
    const where = Prisma.sql`cv.course_id = ${courseId} AND (u.name ILIKE ${search} OR u.email ILIKE ${search}) ${enrolled}`;
    const [rows, count] = await this.db.$transaction([
      this.db.$queryRaw<any[]>(Prisma.sql`SELECT u.id AS student_id, u.name, u.email, COUNT(*)::int AS view_count, MIN(cv.opened_at) AS first_viewed, MAX(cv.opened_at) AS last_viewed, EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id = u.id AND e.course_id = cv.course_id AND e.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM course_entitlements ce WHERE ce.enrollment_id = e.id AND ce.state = 'ACTIVE')) AS enrolled, (SELECT COUNT(*)::int FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = u.id AND l.course_id = cv.course_id AND l.status = 'PUBLISHED') AS completed_lessons, (SELECT COUNT(*)::int FROM lessons l WHERE l.course_id = cv.course_id AND l.status = 'PUBLISHED') AS total_lessons, (SELECT l.title FROM progress p JOIN lessons l ON l.id = p.lesson_id WHERE p.user_id = u.id AND l.course_id = cv.course_id ORDER BY p.completed_at DESC LIMIT 1) AS last_lesson FROM course_views cv JOIN users u ON u.id = cv.student_id WHERE ${where} GROUP BY u.id, u.name, u.email, cv.course_id ORDER BY ${order} LIMIT ${pageSize} OFFSET ${offset}`),
      this.db.$queryRaw<{ total: bigint }[]>(Prisma.sql`SELECT COUNT(DISTINCT u.id)::bigint AS total FROM course_views cv JOIN users u ON u.id = cv.student_id WHERE ${where}`),
    ]);
    return { items: rows.map((row) => ({ ...row, view_count: Number(row.view_count), progress: row.total_lessons ? Math.round((Number(row.completed_lessons) / Number(row.total_lessons)) * 100) : 0, first_viewed: row.first_viewed, last_viewed: row.last_viewed })), total: Number(count[0]?.total ?? 0), page, pageSize };
  }

  async history(user: CurrentUser, courseId: string, studentId: string) {
    this.assertAdmin(user);
    const [course, student, sessions] = await this.db.$transaction([
      this.db.course.findUnique({ where: { id: courseId }, select: { title: true } }),
      this.db.user.findFirst({ where: { id: studentId, role: 'STUDENT' }, select: { id: true, name: true, email: true } }),
      this.db.courseView.findMany({ where: { course_id: courseId, student_id: studentId }, orderBy: { opened_at: 'desc' }, select: { id: true, opened_at: true, last_seen_at: true } }),
    ]);
    if (!course || !student) throw new NotFoundException('Course viewer not found');
    const enrollment = await this.db.enrollment.findUnique({ where: { user_id_course_id: { user_id: studentId, course_id: courseId } }, select: { status: true, entitlement: { select: { state: true } } } });
    return { course, student, total_views: sessions.length, enrolled: enrollment?.status === 'ACTIVE' && enrollment.entitlement?.state === 'ACTIVE', history: sessions.map((session) => ({ ...session, event: 'Opened course overview' })) };
  }
}
