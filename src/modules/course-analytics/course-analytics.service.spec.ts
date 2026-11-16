import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CourseAnalyticsService } from './course-analytics.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';

describe('course analytics', () => {
  const student = { id: 'student-1', role: 'STUDENT' } as CurrentUser;
  it('records an authenticated student session with a 30-minute deduplication key', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const db = { course: { findFirst: vi.fn().mockResolvedValue({ id: 'course-1' }) }, courseView: { upsert } };
    const service = new CourseAnalyticsService(db as unknown as PrismaService);
    await expect(service.recordView(student, 'course-1')).resolves.toEqual({ recorded: true, deduplication_minutes: 30 });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { session_key: expect.stringContaining('course-1:student-1:') } }));
  });
  it('does not track administrators or instructors as student views', async () => {
    const upsert = vi.fn();
    const db = { course: { findFirst: vi.fn() }, courseView: { upsert } };
    const service = new CourseAnalyticsService(db as unknown as PrismaService);
    await expect(service.recordView({ id: 'admin-1', role: 'SUPER_ADMIN' } as CurrentUser, 'course-1')).resolves.toEqual({ recorded: false, reason: 'Only student views are tracked.' });
    expect(upsert).not.toHaveBeenCalled();
  });
  it('rejects unpublished or private courses', async () => {
    const db = { course: { findFirst: vi.fn().mockResolvedValue(null) }, courseView: { upsert: vi.fn() } };
    const service = new CourseAnalyticsService(db as unknown as PrismaService);
    await expect(service.recordView(student, 'course-1')).rejects.toBeInstanceOf(NotFoundException);
  });
  it('limits course analytics to Super Admin', async () => {
    const service = new CourseAnalyticsService({} as PrismaService);
    await expect(service.listCourses({ id: 'admin-1', role: 'ADMIN' } as CurrentUser, '')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
