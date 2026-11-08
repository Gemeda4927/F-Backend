import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../../common/types.js';
import { audit } from '../audit/audit.js';
import type { PageDto, StudentAccessDto, StudentProfileDto, StudentStatusDto } from './students.dto.js';

const profile = { id: true, name: true, email: true, phone: true, active: true, suspended: true, created_at: true, last_login_at: true } as const;
export const accountStatus = (u: { active: boolean; suspended: boolean }) => u.suspended ? 'SUSPENDED' : u.active ? 'ACTIVE' : 'INACTIVE';
const paging = (q: PageDto) => ({ skip: (q.page - 1) * q.pageSize, take: q.pageSize });
const envelope = <T>(items: T[], total: number, q: PageDto) => ({ items, total, page: q.page, pageSize: q.pageSize });

@Injectable()
export class StudentsService {
  constructor(private readonly db: PrismaService) {}
  async student(id: string, tx: Prisma.TransactionClient = this.db) {
    const user = await tx.user.findFirst({ where: { id, role: 'STUDENT' }, select: profile });
    if (!user) throw new NotFoundException('Student not found');
    return user;
  }
  async list(q: PageDto) {
    const where: Prisma.UserWhereInput = { role: 'STUDENT',
      ...(q.status === 'SUSPENDED' ? { suspended: true } : q.status ? { suspended: false, active: q.status === 'ACTIVE' } : {}),
      OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { email: { contains: q.search, mode: 'insensitive' } }],
    };
    const [rows, total] = await this.db.$transaction([
      this.db.user.findMany({ where, select: { ...profile,
        _count: { select: { enrollments: true } },
        devices: { where: { revoked_at: null }, select: { id: true }, take: 1 },
      }, orderBy: [{ [q.sort]: q.direction }, { id: 'asc' }], ...paging(q) }),
      this.db.user.count({ where }),
    ], { isolationLevel: 'RepeatableRead' });
    const payments = await this.db.payment.groupBy({ by: ['user_id', 'currency'], where: { user_id: { in: rows.map(r => r.id) }, status: 'SUCCEEDED', mode: 'live' }, _sum: { amount_minor: true }, _count: true });
    return envelope(rows.map(({ devices, _count, ...u }) => ({ ...u, status: accountStatus(u), course_count: _count.enrollments, device_registered: devices.length > 0,
      verified_payments: payments.filter(p => p.user_id === u.id).map(p => ({ currency: p.currency, amount_minor: p._sum.amount_minor ?? 0, count: p._count })),
    })), total, q);
  }
  async detail(id: string) {
    const u = await this.student(id);
    const [enrollments, completed_lessons, sessions, verified_payments] = await this.db.$transaction([
      this.db.enrollment.count({ where: { user_id: id } }),
      this.db.learningProgress.count({ where: { user_id: id } }),
      this.db.authSession.count({ where: { user_id: id, revoked_at: null, expires_at: { gt: new Date() } } }),
      this.db.payment.count({ where: { user_id: id, status: 'SUCCEEDED' } }),
    ]);
    return { ...u, status: accountStatus(u), stats: { enrollments, completed_lessons, active_sessions: sessions, verified_payments } };
  }
  update(actor: CurrentUser, id: string, dto: StudentProfileDto) {
    return this.db.atomic(async tx => {
      const previous = await this.student(id, tx);
      const next = await tx.user.update({ where: { id }, data: { name: dto.name, email: dto.email?.toLowerCase().trim(), phone: dto.phone }, select: profile });
      const changed = (['name', 'email', 'phone'] as const).filter(field => previous[field] !== next[field]);
      await audit(tx, { actor, target: id, action: 'PROFILE_UPDATED', description: changed.length ? `Student profile updated: ${changed.join(', ')}.` : 'Student profile reviewed without changes.', reason: dto.reason, oldValues: { name: previous.name, email: previous.email, phone: previous.phone }, newValues: { name: next.name, email: next.email, phone: next.phone } });
      return { ...next, status: accountStatus(next) };
    });
  }
  status(actor: CurrentUser, id: string, dto: StudentStatusDto) {
    return this.db.atomic(async tx => {
      const previous = await this.student(id, tx);
      if (accountStatus(previous) === dto.status) return { message: 'Account already has this status.' };
      await tx.user.update({ where: { id }, data: { active: dto.status === 'ACTIVE', suspended: dto.status === 'SUSPENDED', auth_version: { increment: 1 } } });
      const revoked = await tx.authSession.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
      await audit(tx, { actor, target: id, action: dto.status === 'ACTIVE' ? (previous.suspended ? 'ACCOUNT_RESTORED' : 'ACCOUNT_ACTIVATED') : dto.status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_DEACTIVATED', description: `Student account set to ${dto.status.toLowerCase()}; existing sessions revoked.`, reason: dto.reason, oldValues: { status: accountStatus(previous) }, newValues: { status: dto.status, sessions_revoked: revoked.count } });
      return { message: 'Account status updated and sessions revoked.' };
    });
  }
  revokeSessions(actor: CurrentUser, id: string, reason: string) {
    return this.db.atomic(async tx => {
      await this.student(id, tx);
      await tx.user.update({ where: { id }, data: { auth_version: { increment: 1 } } });
      const result = await tx.authSession.updateMany({ where: { user_id: id, revoked_at: null }, data: { revoked_at: new Date() } });
      await audit(tx, { actor, target: id, action: 'SESSIONS_REVOKED', description: 'All existing sessions revoked; device registration retained.', reason, newValues: { revoked_sessions: result.count } });
      return { message: 'Sessions revoked.' };
    });
  }
  async courses(id: string, q: PageDto) {
    await this.student(id);
    const where = { user_id: id };
    const [rows, total] = await this.db.$transaction([
      this.db.enrollment.findMany({ where, ...paging(q), orderBy: [{ created_at: 'desc' }, { id: 'asc' }], select: {
        id: true, course_id: true, created_at: true, status: true, payment_id: true,
        entitlement: { select: { state: true } }, payment: { select: { status: true } },
        course: { select: { title: true, published: true, instructor: { select: { name: true } }, _count: { select: { lessons: true } }, lessons: { select: { _count: { select: { progress: { where: { user_id: id } } } } } } } },
      } }), this.db.enrollment.count({ where }),
    ]);
    return envelope(rows.map(({ course, ...r }) => {
      const completed = course.lessons.reduce((sum, l) => sum + l._count.progress, 0), count = course._count.lessons;
      return { ...r, title: course.title, instructor: course.instructor.name, lesson_count: count, completed_count: completed, progress: count ? Math.round(completed / count * 100) : 0,
        completed: count > 0 && completed >= count, access: course.published && r.status === 'ACTIVE' && r.entitlement?.state === 'ACTIVE' && (!r.payment_id || r.payment?.status === 'SUCCEEDED') };
    }), total, q);
  }
  async payments(id: string, q: PageDto) {
    await this.student(id);
    const where = { user_id: id };
    const [items, total] = await this.db.$transaction([
      this.db.payment.findMany({ where, ...paging(q), orderBy: [{ created_at: 'desc' }, { id: 'asc' }], select: { id: true, tx_ref: true, amount_minor: true, currency: true, status: true, created_at: true, updated_at: true, course: { select: { title: true } } } }),
      this.db.payment.count({ where }),
    ]);
    // Verification time is supplied by an actual verification audit event, never inferred from updated_at.
    const events = await this.db.auditLog.findMany({ where: { target_id: id, action: 'PAYMENT_VERIFIED', resource_id: { in: items.map(p => p.id) } }, select: { resource_id: true, created_at: true } });
    return envelope(items.map(p => ({ ...p, provider: 'Chapa', verified_at: events.find(e => e.resource_id === p.id)?.created_at ?? null })), total, q);
  }
  async devices(id: string, q: PageDto) {
    await this.student(id);
    const [items, total, sessions, sessionTotal] = await this.db.$transaction([
      this.db.studentDevice.findMany({ where: { user_id: id }, ...paging(q), orderBy: [{ registered_at: 'desc' }, { id: 'asc' }], select: { id: true, label: true, registered_at: true, last_seen_at: true, revoked_at: true } }),
      this.db.studentDevice.count({ where: { user_id: id } }),
      this.db.authSession.findMany({ where: { user_id: id }, ...paging(q), orderBy: [{ created_at: 'desc' }, { id: 'asc' }], select: { id: true, device_id: true, created_at: true, expires_at: true, revoked_at: true } }),
      this.db.authSession.count({ where: { user_id: id } }),
    ]);
    return { ...envelope(items, total, q), sessions: envelope(sessions.map(s => ({ ...s, active: !s.revoked_at && s.expires_at > new Date() })), sessionTotal, q) };
  }
  async logs(q: PageDto, id?: string) {
    if (id) await this.student(id);
    // Older payment audit rows used payment IDs as targets; include those without
    // rewriting historical records or treating unrelated IDs as student events.
    const legacyPaymentIds = id ? (await this.db.payment.findMany({ where: { user_id: id }, select: { id: true } })).map(p => p.id) : [];
    const where: Prisma.AuditLogWhereInput = { ...(id ? { OR: [{ target_id: id }, { target_id: { in: legacyPaymentIds }, action: { in: ['ACCESS_REVOKED', 'REFUND_REQUESTED'] }, resource_type: null }] } : {}), ...(q.action ? { action: q.action } : {}) };
    const [items, total] = await this.db.$transaction([
      this.db.auditLog.findMany({ where, ...paging(q), orderBy: [{ created_at: 'desc' }, { id: 'desc' }], select: { id: true, actor_id: true, actor_name: true, actor_role: true, target_id: true, action: true, description: true, resource_type: true, resource_id: true, old_values: true, new_values: true, reason: true, created_at: true, actor: { select: { name: true, role: true } } } }),
      this.db.auditLog.count({ where }),
    ]);
    return envelope(items, total, q);
  }
  access(actor: CurrentUser, id: string, dto: StudentAccessDto) {
    return this.db.atomic(async tx => {
      await this.student(id, tx);
      const course = await tx.course.findUnique({ where: { id: dto.course_id }, select: { id: true, title: true, published: true, archived_at: true } });
      if (!course) throw new NotFoundException('Course not found');
      if (dto.operation === 'GRANT' && (!course.published || course.archived_at)) throw new ConflictException('Publish and restore this course before granting student access');
      const previous = await tx.enrollment.findUnique({ where: { user_id_course_id: { user_id: id, course_id: course.id } }, include: { entitlement: true, payment: { select: { status: true } } } });
      if (dto.operation === 'REVOKE' && !previous) throw new ConflictException('Student is not enrolled in this course');
      const grant = dto.operation === 'GRANT';
      // An explicit complimentary grant detaches any failed/refunded payment; the payment itself is immutable here.
      const enrollment = await tx.enrollment.upsert({ where: { user_id_course_id: { user_id: id, course_id: course.id } },
        create: { user_id: id, course_id: course.id, status: grant ? 'ACTIVE' : 'REVOKED' },
        update: { status: grant ? 'ACTIVE' : 'REVOKED', ...(grant && previous?.payment && previous.payment.status !== 'SUCCEEDED' ? { payment_id: null } : {}) },
      });
      await tx.courseEntitlement.upsert({ where: { enrollment_id: enrollment.id }, create: { enrollment_id: enrollment.id, state: grant ? 'ACTIVE' : 'REVOKED', revoked_at: grant ? null : new Date() }, update: { state: grant ? 'ACTIVE' : 'REVOKED', revoked_at: grant ? null : new Date(), ...(grant ? { granted_at: new Date() } : {}) } });
      await audit(tx, { actor, target: id, action: grant ? 'COURSE_ACCESS_GRANTED' : 'COURSE_ACCESS_REVOKED', description: `${grant ? 'Granted' : 'Revoked'} administrative course access: ${course.title}.`, reason: dto.reason, resourceType: 'COURSE', resourceId: course.id, oldValues: { status: previous?.status ?? 'NOT_ENROLLED', entitlement: previous?.entitlement?.state ?? 'NONE' }, newValues: { status: grant ? 'ACTIVE' : 'REVOKED', access_source: 'ADMINISTRATIVE' } });
      return { message: 'Course access updated. Payment records were not changed.' };
    });
  }
}
