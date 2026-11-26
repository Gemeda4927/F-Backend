import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesService } from '../courses/courses.service.js';

type Period = 'all-time' | 'weekly' | 'monthly';

@Injectable()
export class CompetitionsService {
  constructor(private readonly db: PrismaService, private readonly courses: CoursesService) {}

  private periodStart(period: Period) {
    const now = new Date();
    if (period === 'weekly') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    if (period === 'monthly') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    return undefined;
  }

  private async courseCompetition(user: CurrentUser, courseId: string) {
    if (!(await this.courses.canAccess(user, courseId))) throw new ForbiddenException('Course access required');
    return this.db.courseCompetition.findFirst({
      where: { course_id: courseId, status: 'ACTIVE' },
      include: { rules: { where: { version: { equals: 1 }, enabled: true } } },
    });
  }

  private async addEvent(data: { competition_id: string; course_id: string; student_id: string; category: string; source_type: string; source_id: string; points: number; reason: string }) {
    if (data.points <= 0) return;
    await this.db.competitionPointEvent.create({ data: { ...data, idempotency_key: `${data.competition_id}:${data.student_id}:${data.source_type}:${data.source_id}` } }).catch((error: any) => {
      if (error?.code !== 'P2002') throw error;
    });
  }

  private rule(rules: { category: string; points: number }[], category: string, fallback: number) {
    return rules.find((rule) => rule.category === category)?.points ?? fallback;
  }

  private async syncStudent(competition: { id: string; course_id: string; rules: { category: string; points: number }[] }, studentId: string) {
    const [sections, tasks, assessments, contributions] = await Promise.all([
      this.db.lessonSectionProgress.findMany({ where: { user_id: studentId, lesson: { course_id: competition.course_id } }, select: { lesson_id: true }, distinct: ['lesson_id'] }),
      this.db.assignmentSubmission.findMany({ where: { student_id: studentId, status: 'APPROVED', assignment: { course_id: competition.course_id, task_mode: 'PRACTICAL_TASK' } }, select: { id: true, score: true, assignment: { select: { title: true, max_marks: true } } } }),
      this.db.assessmentSubmission.findMany({ where: { student_id: studentId, reviewed_at: { not: null }, score: { not: null }, assessment: { course_id: competition.course_id, published: true } }, select: { id: true, score: true, assessment: { select: { title: true, max_score: true } } } }),
      this.db.contributionCreditEvent.findMany({ where: { user_id: studentId, contribution: { course_id: competition.course_id, status: 'APPROVED' } }, select: { id: true, amount: true, event: true } }),
    ]);
    const lessonPoints = this.rule(competition.rules, 'LESSON_COMPLETION', 10);
    for (const row of sections) await this.addEvent({ competition_id: competition.id, course_id: competition.course_id, student_id: studentId, category: 'LESSON_COMPLETION', source_type: 'LESSON', source_id: row.lesson_id, points: lessonPoints, reason: 'Completed lesson' });
    const taskMax = this.rule(competition.rules, 'PRACTICAL_TASK', 100);
    for (const row of tasks) await this.addEvent({ competition_id: competition.id, course_id: competition.course_id, student_id: studentId, category: 'PRACTICAL_TASK', source_type: 'TASK_SUBMISSION', source_id: row.id, points: Math.round(((row.score ?? 0) / Math.max(row.assignment.max_marks ?? 100, 1)) * taskMax), reason: `Approved practical task: ${row.assignment.title}` });
    const assessmentMax = this.rule(competition.rules, 'ASSESSMENT', 100);
    for (const row of assessments) await this.addEvent({ competition_id: competition.id, course_id: competition.course_id, student_id: studentId, category: 'ASSESSMENT', source_type: 'ASSESSMENT_SUBMISSION', source_id: row.id, points: Math.round(((row.score ?? 0) / Math.max(row.assessment.max_score, 1)) * assessmentMax), reason: `Reviewed assessment: ${row.assessment.title}` });
    const contributionMax = this.rule(competition.rules, 'CONTRIBUTION', 5);
    for (const row of contributions) await this.addEvent({ competition_id: competition.id, course_id: competition.course_id, student_id: studentId, category: 'CONTRIBUTION', source_type: 'CONTRIBUTION_CREDIT', source_id: row.id, points: Math.min(Math.max(row.amount, 0), contributionMax), reason: `Approved contribution: ${row.event}` });
  }

  async overview(user: CurrentUser, courseId: string) {
    const competition = await this.courseCompetition(user, courseId);
    if (!competition) return { enabled: false, course_id: courseId, message: 'No competition has been activated for this course.' };
    await this.syncStudent(competition, user.id);
    return { enabled: true, id: competition.id, title: competition.title, status: competition.status, categories: competition.rules.map((rule) => ({ category: rule.category, points: rule.points })) };
  }

  async leaderboard(user: CurrentUser, courseId: string, period: Period = 'all-time', category = 'overall', page = 1) {
    const competition = await this.courseCompetition(user, courseId);
    if (!competition) return { enabled: false, rankings: [], total: 0, message: 'No competition has been activated for this course.' };
    const enrollments = await this.db.enrollment.findMany({ where: { course_id: courseId, status: 'ACTIVE', user: { active: true, suspended: false } }, select: { user_id: true, user: { select: { name: true } } } });
    await Promise.all(enrollments.map(({ user_id }) => this.syncStudent(competition, user_id)));
    const start = this.periodStart(period);
    const where = { competition_id: competition.id, ...(start ? { created_at: { gte: start } } : {}), ...(category !== 'overall' ? { category } : {}) };
    const totals = await this.db.competitionPointEvent.groupBy({ by: ['student_id'], where, _sum: { points: true } });
    const visibility = await this.db.competitionVisibility.findMany({ where: { competition_id: competition.id }, select: { student_id: true, display_name: true, show_on_board: true, opt_out: true } });
    const visibilityMap = new Map(visibility.map((row) => [row.student_id, row]));
    const names = new Map(enrollments.map((row) => [row.user_id, row.user.name]));
    const rows = totals.filter((row) => { const pref = visibilityMap.get(row.student_id); return !pref?.opt_out && pref?.show_on_board !== false; }).map((row) => ({ student_id: row.student_id, name: visibilityMap.get(row.student_id)?.display_name || names.get(row.student_id) || 'Student', points: row._sum.points ?? 0 }));
    rows.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    let previous: number | undefined;
    let rank = 0;
    const ranked = rows.map((row, index) => { if (row.points !== previous) rank = index + 1; previous = row.points; return { ...row, rank }; });
    const size = 20;
    return { enabled: true, competition: { id: competition.id, title: competition.title }, period, category, page, page_size: size, total: ranked.length, rankings: ranked.slice((page - 1) * size, page * size), current_user: ranked.find((row) => row.student_id === user.id) ?? null };
  }

  async performance(user: CurrentUser, courseId: string) {
    const [allTime, weekly, monthly] = await Promise.all([this.leaderboard(user, courseId, 'all-time'), this.leaderboard(user, courseId, 'weekly'), this.leaderboard(user, courseId, 'monthly')]);
    if (!allTime.enabled) return allTime;
    return { enabled: true, all_time: allTime.current_user, weekly: weekly.current_user, monthly: monthly.current_user };
  }

  async visibility(user: CurrentUser, courseId: string, data: { display_name?: string; show_on_board?: boolean; opt_out?: boolean }) {
    const competition = await this.courseCompetition(user, courseId);
    if (!competition) throw new NotFoundException('Competition is not active for this course');
    return this.db.competitionVisibility.upsert({ where: { competition_id_student_id: { competition_id: competition.id, student_id: user.id } }, create: { competition_id: competition.id, student_id: user.id, display_name: data.display_name?.trim() || null, show_on_board: data.show_on_board ?? true, opt_out: data.opt_out ?? false }, update: { ...(data.display_name !== undefined ? { display_name: data.display_name.trim() || null } : {}), ...(data.show_on_board !== undefined ? { show_on_board: data.show_on_board } : {}), ...(data.opt_out !== undefined ? { opt_out: data.opt_out } : {}) } });
  }

  async activate(user: CurrentUser, courseId: string, title?: string) {
    const course = await this.db.course.findUnique({ where: { id: courseId }, select: { id: true, instructor_id: true } });
    if (!course) throw new NotFoundException('Course not found');
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role) && !(user.role === 'INSTRUCTOR' && user.id === course.instructor_id)) throw new ForbiddenException('You may activate only your own course competition');
    return this.db.courseCompetition.upsert({ where: { course_id: courseId }, create: { course_id: courseId, created_by: user.id, title: title?.trim() || 'Course competition', rules: { create: [{ version: 1, category: 'LESSON_COMPLETION', points: 10 }, { version: 1, category: 'PRACTICAL_TASK', points: 100 }, { version: 1, category: 'ASSESSMENT', points: 100 }, { version: 1, category: 'CONTRIBUTION', points: 5 }] } }, update: { status: 'ACTIVE', ...(title?.trim() ? { title: title.trim() } : {}) }, include: { rules: true } });
  }
}
