import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { CoursesService } from './courses.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';

describe('course preview', () => {
  const instructor = { id: 'teacher-1', role: 'INSTRUCTOR' } as CurrentUser;
  it('loads only the selected preview fields for the owner', async () => {
    const db = {
      course: {
        findUnique: vi.fn().mockResolvedValue({ instructor_id: instructor.id }),
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ title: 'Draft', lessons: [] }),
      },
    };
    const service = new CoursesService(db as unknown as PrismaService);
    await expect(service.preview(instructor, 'course-1')).resolves.toEqual({
      title: 'Draft',
      lessons: [],
    });
    const select = db.course.findUniqueOrThrow.mock.calls[0][0].select;
    expect(select.lessons.select).not.toHaveProperty('quiz');
    expect(select.lessons.select).not.toHaveProperty('content');
  });
  it('refuses an instructor who does not own the course', async () => {
    const db = {
      course: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ instructor_id: 'someone-else' }),
        findUniqueOrThrow: vi.fn(),
      },
    };
    const service = new CoursesService(db as unknown as PrismaService);
    await expect(
      service.preview(instructor, 'course-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.course.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('archives only an owned course without changing publication or enrollment', async () => {
    const db = {
      course: {
        findUnique: vi.fn().mockResolvedValue({ instructor_id: instructor.id }),
        update: vi.fn().mockResolvedValue({ id: 'course-1' }),
      },
    };
    const service = new CoursesService(db as unknown as PrismaService);
    await service.archive(instructor, 'course-1', true);
    expect(db.course.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { archived_at: expect.any(Date) } }),
    );
  });
  it('preserves access for an actively enrolled student after archive', async () => {
    const db = {
      course: {
        findUnique: vi.fn().mockResolvedValue({
          instructor_id: instructor.id,
          published: true,
          archived_at: new Date(),
        }),
      },
      enrollment: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'ACTIVE',
          entitlement: { state: 'ACTIVE' },
          payment_id: null,
        }),
      },
    };
    const service = new CoursesService(db as unknown as PrismaService);
    await expect(
      service.canAccess(
        { id: 'student-1', role: 'STUDENT' } as CurrentUser,
        'course-1',
      ),
    ).resolves.toBe(true);
  });
  it('requires explicit public visibility for catalog and index queries', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const service = new CoursesService({
      course: { findMany },
    } as unknown as PrismaService);
    await service.catalog();
    await service.indexable();
    for (const call of findMany.mock.calls)
      expect(call[0].where).toEqual(
        expect.objectContaining({
          visibility: 'PUBLIC',
          published: true,
          archived_at: null,
        }),
      );
  });
  it('does not return details when the public visibility query has no match', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const service = new CoursesService({
      course: { findFirst },
    } as unknown as PrismaService);
    await expect(service.details('private-course')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(findFirst.mock.calls[0][0].where).toEqual(
      expect.objectContaining({
        visibility: 'PUBLIC',
        published: true,
        archived_at: null,
      }),
    );
  });
});
