import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesService } from '../courses/courses.service.js';
import type { LessonDto, QuestionDto } from './lessons.dto.js';
import { notifyCourse } from '../notifications/notifications.js';
@Injectable()
export class LessonsService {
  constructor(
    private readonly db: PrismaService,
    private readonly courses: CoursesService,
  ) {}
  async authorized(user: CurrentUser | undefined, id: string) {
    const lesson = await this.db.lesson.findUnique({
      where: { id },
      include: {
        course: {
          select: { published: true, archived_at: true, visibility: true },
        },
      },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (
      !(
        lesson.preview &&
        lesson.course.published &&
        !lesson.course.archived_at &&
        lesson.course.visibility === 'PUBLIC'
      ) &&
      (!user || !(await this.courses.canAccess(user, lesson.course_id)))
    )
      throw new ForbiddenException(
        'Purchase this course to access this lesson',
      );
    const { course, ...safe } = lesson;
    return { ...safe, published: course.published };
  }
  private safe(lesson: Awaited<ReturnType<LessonsService['authorized']>>) {
    const { storage_path, quiz, published: _published, ...safe } = lesson;
    return {
      ...safe,
      has_file: !!storage_path,
      quiz:
        (quiz as unknown as QuestionDto[] | null)?.map((q) => ({
          question: q.question,
          options: q.options,
        })) ?? [],
    };
  }
  async detail(user: CurrentUser, id: string) {
    return this.safe(await this.authorized(user, id));
  }
  async preview(id: string) {
    return this.safe(await this.authorized(undefined, id));
  }
  async save(user: CurrentUser, courseId: string, dto: LessonDto, id?: string) {
    await this.courses.assertOwner(user, courseId);
    if (dto.practice && dto.kind !== 'QUIZ')
      throw new BadRequestException('Practice tests must use quiz questions');
    if (
      dto.kind === 'QUIZ' &&
      (!dto.quiz?.length ||
        dto.quiz.some((q) => q.correctIndex >= q.options.length))
    )
      throw new BadRequestException(
        'Provide valid quiz questions and answer indices',
      );
    const { quiz, ...rest } = dto;
    if (
      dto.chapter !== undefined &&
      (typeof dto.chapter !== 'string' || !dto.chapter.trim())
    )
      throw new BadRequestException('Enter a chapter name');
    const data = {
      ...rest,
      quiz:
        dto.kind === 'QUIZ'
          ? (quiz as unknown as Prisma.InputJsonValue)
          : Prisma.DbNull,
    };
    if (id) {
      const existing = await this.db.lesson.findFirst({
        where: { id, course_id: courseId },
      });
      if (!existing) throw new NotFoundException();
      return this.db.atomic(async (tx) => {
        const updated = await tx.lesson.update({
          where: { id },
          data,
          select: { id: true },
        });
        await notifyCourse(tx, courseId, {
          event_key: `lesson-update:${id}:${new Date().toISOString()}`,
          kind: 'CONTENT',
          title: `Lesson updated: ${dto.title}`,
          message: 'Your instructor updated this learning activity.',
          href: `/learn/${courseId}/activities/${id}?type=lesson`,
        });
        return updated;
      });
    }
    return this.db.atomic(async (tx) => {
      const lesson = await tx.lesson.create({
        data: { ...data, course_id: courseId },
        select: { id: true },
      });
      await notifyCourse(tx, courseId, {
        event_key: `lesson:${lesson.id}`,
        kind: dto.kind === 'QUIZ' ? 'QUIZ' : 'CONTENT',
        title: `New ${dto.practice ? 'practice test' : dto.kind === 'QUIZ' ? 'quiz' : 'lesson'}: ${dto.title}`,
        message: 'New learning content is available.',
        href: `/learn/${courseId}/activities/${lesson.id}?type=lesson`,
      });
      return lesson;
    });
  }
  async progress(user: CurrentUser, courseId: string) {
    if (!(await this.courses.canAccess(user, courseId)))
      throw new ForbiddenException('Course access required');
    return this.db.learningProgress.findMany({
      where: { user_id: user.id, lesson: { course_id: courseId } },
    });
  }
  async complete(user: CurrentUser, id: string, answers?: number[]) {
    if (user.role !== 'STUDENT')
      throw new ForbiddenException(
        'Only student accounts record learning progress',
      );
    const lesson = await this.authorized(user, id);
    if (!(await this.courses.canAccess(user, lesson.course_id)))
      throw new ForbiddenException('Enrollment required');
    let score: number | null = null;
    if (lesson.kind === 'QUIZ') {
      const quiz = lesson.quiz as unknown as QuestionDto[];
      if (!answers || answers.length !== quiz.length)
        throw new BadRequestException('Answer every quiz question');
      score = Math.round(
        (100 * quiz.filter((q, i) => q.correctIndex === answers[i]).length) /
          quiz.length,
      );
      if (
        answers.some(
          (answer, i) =>
            !Number.isInteger(answer) ||
            answer < 0 ||
            answer >= quiz[i].options.length,
        )
      )
        throw new BadRequestException(
          'Select a valid answer for every question',
        );
      if (score < 70) return { passed: false, score };
    }
    await this.db.atomic(async (tx) => {
      if (!(await this.courses.canAccess(user, lesson.course_id, tx)))
        throw new ForbiddenException('Enrollment required');
      return tx.learningProgress.upsert({
        where: { user_id_lesson_id: { user_id: user.id, lesson_id: id } },
        create: { user_id: user.id, lesson_id: id, score },
        update: { score, completed_at: new Date() },
      });
    });
    return {
      passed: true,
      score,
      explanations:
        lesson.kind === 'QUIZ'
          ? (lesson.quiz as unknown as QuestionDto[]).map((q) => ({
              question: q.question,
              correctIndex: q.correctIndex,
              explanation: q.explanation ?? '',
            }))
          : [],
    };
  }
}
