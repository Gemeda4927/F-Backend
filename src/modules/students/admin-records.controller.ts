import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators/permissions.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { PageDto } from './students.dto.js';
@Controller('admin') @Permissions('roles:manage', 'users:manage') @ApiCookieAuth('access_token') @ApiTags('Super Admin records')
export class AdminRecordsController {
  constructor(private readonly db: PrismaService) {}
  @Get('revenue') @ApiOperation({ summary: 'Aggregate verified revenue separately by currency' })
  async revenue() {
    const rows = await this.db.payment.groupBy({ by: ['currency', 'status'], _sum: { amount_minor: true }, _count: true, orderBy: { currency: 'asc' } });
    return rows.map(r => ({ currency: r.currency, status: r.status, amount_minor: r._sum.amount_minor ?? 0, count: r._count }));
  }
  @Get('settings') @ApiOperation({ summary: 'Inspect safe, effective runtime policies; excludes all credentials' })
  settings() {
    return { authentication: 'HTTP-only cookie sessions', registered_browser_limit: 1,
      access_token_lifetime_minutes: 15, session_lifetime_days: 30,
      secure_cookies: process.env.COOKIE_SECURE === 'true',
      payment_mode: process.env.CHAPA_MODE ?? 'test',
      audit_access: 'Super Admin; read-only through the API',
      payment_access: 'Server-verified payment or explicit audited administrative grant',
    };
  }
  @Get('records/:kind') @ApiOperation({ summary: 'Paginate enrollments, learning progress or registered devices' })
  async records(@Param('kind') kind: string, @Query() q: PageDto) {
    const paging = { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
    if (kind === 'enrollments' || kind === 'progress') {
      const [rows, total] = await this.db.$transaction([
        this.db.enrollment.findMany({ ...paging, orderBy: [{ created_at: 'desc' }, { id: 'asc' }], select: { id: true, user_id: true, status: true, created_at: true, entitlement: { select: { state: true } }, user: { select: { name: true } }, course: { select: { id: true, title: true, _count: { select: { lessons: true } } } } } }),
        this.db.enrollment.count(),
      ]);
      const completed = kind === 'progress' ? await this.db.learningProgress.findMany({ where: { OR: rows.map(r => ({ user_id: r.user_id, lesson: { course_id: r.course.id } })) }, select: { user_id: true, lesson: { select: { course_id: true } } } }) : [];
      return { items: rows.map(r => ({ id: r.id, student_id: r.user_id, student_name: r.user.name, title: r.course.title, status: r.status,
        detail: kind === 'progress' ? `${completed.filter(p => p.user_id === r.user_id && p.lesson.course_id === r.course.id).length} / ${r.course._count.lessons} lessons completed` : `Entitlement: ${r.entitlement?.state ?? 'NONE'}`,
        created_at: r.created_at })), total, page: q.page, pageSize: q.pageSize };
    }
    if (kind === 'devices') {
      const [rows, total] = await this.db.$transaction([
        this.db.studentDevice.findMany({ ...paging, orderBy: [{ registered_at: 'desc' }, { id: 'asc' }], select: { id: true, user_id: true, label: true, registered_at: true, last_seen_at: true, revoked_at: true, user: { select: { name: true } } } }),
        this.db.studentDevice.count(),
      ]);
      return { items: rows.map(r => ({ id: r.id, student_id: r.user_id, student_name: r.user.name, title: r.label, status: r.revoked_at ? 'REVOKED' : 'REGISTERED', detail: `Last seen: ${r.last_seen_at.toISOString()}`, created_at: r.registered_at })), total, page: q.page, pageSize: q.pageSize };
    }
    throw new BadRequestException('Unsupported record type');
  }
}
