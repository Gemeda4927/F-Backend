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
@Injectable()
export class LessonsService {
  constructor(
    private readonly db: PrismaService,
    private readonly courses: CoursesService,
  ) {}
  async authorized(user: CurrentUser | undefined, id: string) {
    const lesson = await this.db.lesson.findUnique({
      where: { id },
      include: { course: { select: { published: true, archived_at: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    if (
      !(lesson.preview && lesson.course.published && !lesson.course.archived_at) &&
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
    if (
      dto.kind === 'QUIZ' &&
      (!dto.quiz?.length ||
        dto.quiz.some((q) => q.correctIndex >= q.options.length))
    )
      throw new BadRequestException(
        'Provide valid quiz questions and answer indices',
      );
    const { quiz, ...rest } = dto;
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
      return this.db.lesson.update({
        where: { id },
        data,
        select: { id: true },
      });
    }
    return this.db.lesson.create({
      data: { ...data, course_id: courseId },
      select: { id: true },
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
      if (score < 70) return { passed: false, score };
    }
    await this.db.learningProgress.upsert({
      where: { user_id_lesson_id: { user_id: user.id, lesson_id: id } },
      create: { user_id: user.id, lesson_id: id, score },
      update: { score, completed_at: new Date() },
    });
    return { passed: true, score };
  }
}
