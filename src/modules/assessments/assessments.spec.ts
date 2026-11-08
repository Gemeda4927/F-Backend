import { describe, expect, it, vi } from 'vitest';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AssessmentsController } from './assessments.module.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { CoursesService } from '../courses/courses.service.js';
import type { CurrentUser } from '../../common/types.js';

const student = { id: 'student', role: 'STUDENT' } as CurrentUser;
const instructor = { id: 'teacher', role: 'INSTRUCTOR' } as CurrentUser;
describe('assessment authorization', () => {
  it('rejects submissions without course access', async () => {
    const db = {
      assessment: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ course_id: 'course', published: true }),
      },
      assessmentSubmission: { create: vi.fn() },
    };
    const courses = { canAccess: vi.fn().mockResolvedValue(false) };
    const controller = new AssessmentsController(
      db as unknown as PrismaService,
      courses as unknown as CoursesService,
    );
    await expect(
      controller.submit(student, 'assessment', { answer: 'Answer' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.assessmentSubmission.create).not.toHaveBeenCalled();
  });
  it('does not allow instructors to review another instructor’s course', async () => {
    const db = {
      assessmentSubmission: {
        findUnique: vi.fn().mockResolvedValue({
          assessment: { course_id: 'course', max_score: 100 },
        }),
        update: vi.fn(),
      },
    };
    const courses = {
      assertOwner: vi.fn().mockRejectedValue(new ForbiddenException()),
    };
    const controller = new AssessmentsController(
      db as unknown as PrismaService,
      courses as unknown as CoursesService,
    );
    await expect(
      controller.review(instructor, 'submission', { score: 50, feedback: '' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.assessmentSubmission.update).not.toHaveBeenCalled();
  });
  it('rejects scores above the assessment maximum', async () => {
    const db = {
      assessmentSubmission: {
        findUnique: vi.fn().mockResolvedValue({
          assessment: { course_id: 'course', max_score: 10 },
        }),
        update: vi.fn(),
      },
    };
    const courses = {
      assertOwner: vi.fn().mockResolvedValue({}),
      canAccess: vi.fn().mockResolvedValue(true),
    };
    const controller = new AssessmentsController(
      db as unknown as PrismaService,
      courses as unknown as CoursesService,
    );
    await expect(
      controller.review(instructor, 'submission', { score: 11, feedback: '' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.assessmentSubmission.update).not.toHaveBeenCalled();
  });
  it('does not permit changing an assessment after a submission', async () => {
    const update = vi.fn();
    const tx = {
      assessmentSubmission: { count: vi.fn().mockResolvedValue(1) },
      assessment: { update },
    };
    const db = {
      assessment: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ course_id: 'course', published: true }),
      },
      atomic: (work: (transaction: typeof tx) => unknown) => work(tx),
    };
    const courses = {
      assertOwner: vi.fn().mockResolvedValue({}),
      canAccess: vi.fn().mockResolvedValue(true),
    };
    const controller = new AssessmentsController(
      db as unknown as PrismaService,
      courses as unknown as CoursesService,
    );
    await expect(
      controller.update(instructor, 'assessment', {
        title: 'Exam',
        kind: 'EXAM',
        prompt: 'Question',
        max_score: 100,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(update).not.toHaveBeenCalled();
  });
  it('limits the review queue to courses owned by the instructor', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const controller = new AssessmentsController(
      { assessmentSubmission: { findMany } } as unknown as PrismaService,
      {} as CoursesService,
    );
    await controller.reviews(instructor);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { assessment: { course: { instructor_id: instructor.id } } },
      }),
    );
  });
  it('requires answers to match the current questions and records them in order', async () => {
    const questions = ['First question?', 'Second question?'];
    const create = vi.fn().mockResolvedValue({ id: 'submission' });
    const current = {
      published: true,
      allow_resume: true,
      question_bank: [],
      id: 'assessment',
      course_id: 'course',
      questions,
      prompt: 'Instructions',
      max_score: 100,
      max_attempts: 1,
    };
    const tx = {
      assessment: { findUniqueOrThrow: vi.fn().mockResolvedValue(current) },
      assessmentAttempt: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'attempt', number: 1 }),
        update: vi.fn(),
      },
      assessmentSubmission: {
        findUnique: vi.fn().mockResolvedValue(null),
        upsert: create,
      },
      course: {
        findUniqueOrThrow: vi
          .fn()
          .mockResolvedValue({ instructor_id: 'teacher' }),
      },
      notification: { createMany: vi.fn() },
    };
    const db = {
      assessment: { findUnique: vi.fn().mockResolvedValue(current) },
      atomic: (work: (transaction: typeof tx) => unknown) => work(tx),
    };
    const controller = new AssessmentsController(
      db as unknown as PrismaService,
      {
        canAccess: vi.fn().mockResolvedValue(true),
      } as unknown as CoursesService,
    );
    await expect(
      controller.submit(student, 'assessment', {
        answers: ['One', 'Two'],
        expected_questions: questions,
        expected_prompt: 'Instructions',
        expected_max_score: 100,
      }),
    ).resolves.toEqual({ id: 'submission' });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          answer: '1. First question?\nOne\n\n2. Second question?\nTwo',
        }),
      }),
    );
    await expect(
      controller.submit(student, 'assessment', {
        answers: ['One', 'Two'],
        expected_questions: ['Changed', 'Second question?'],
        expected_prompt: 'Instructions',
        expected_max_score: 100,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
