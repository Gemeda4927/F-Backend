import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesService } from '../courses/courses.service.js';
import { audit } from '../audit/audit.js';
import { notifyCourse } from '../notifications/notifications.js';
import { copyPrivateFile, removePrivateFile } from '../lessons/storage.js';
import {
  applyLayout,
  currentLayout,
  effectiveLesson,
  lessonProblems,
  type LessonFields,
} from './curriculum.js';
import type {
  CreateLessonDto,
  CurriculumDto,
  LessonDraftDto,
} from './studio.dto.js';

export type Issue = {
  code: string;
  message: string;
  tab: 'settings' | 'chapters';
  lesson_id?: string;
};

const lessonSelect = {
  id: true,
  course_id: true,
  chapter_id: true,
  title: true,
  kind: true,
  preview: true,
  practice: true,
  content: true,
  quiz: true,
  storage_path: true,
  status: true,
  draft: true,
  revision: true,
  published_at: true,
} satisfies Prisma.LessonSelect;
type StudioLesson = Prisma.LessonGetPayload<{ select: typeof lessonSelect }>;

const asFields = (l: StudioLesson): LessonFields & StudioLesson => ({
  ...l,
  quiz: (l.quiz as LessonFields['quiz']) ?? null,
});

@Injectable()
export class StudioService {
  constructor(
    private readonly db: PrismaService,
    private readonly courses: CoursesService,
  ) {}

  private async lessonFor(
    user: CurrentUser,
    id: string,
    tx: Prisma.TransactionClient,
  ) {
    const lesson = await tx.lesson.findUnique({
      where: { id },
      select: lessonSelect,
    });
    if (!lesson) throw new NotFoundException('Topic not found');
    const course = await this.courses.assertOwner(user, lesson.course_id, tx);
    return { lesson, course };
  }

  private async chapterFor(
    user: CurrentUser,
    id: string,
    tx: Prisma.TransactionClient,
  ) {
    const chapter = await tx.chapter.findUnique({ where: { id } });
    if (!chapter) throw new NotFoundException('Chapter not found');
    const course = await this.courses.assertOwner(user, chapter.course_id, tx);
    return { chapter, course };
  }

  // ---------- Curriculum ----------

  curriculum(user: CurrentUser, courseId: string) {
    return this.db.atomic(async (tx) => {
      await this.courses.assertOwner(user, courseId, tx);
      const layout = await currentLayout(tx, courseId);
      const chapters = await tx.chapter.findMany({
        where: { course_id: courseId },
        select: { id: true, title: true },
      });
      const lessons = await tx.lesson.findMany({
        where: { course_id: courseId },
        select: {
          id: true,
          title: true,
          kind: true,
          preview: true,
          practice: true,
          status: true,
          draft: true,
          revision: true,
          storage_path: true,
          _count: { select: { progress: true } },
        },
      });
      const byId = new Map(lessons.map((l) => [l.id, l]));
      const titles = new Map(chapters.map((c) => [c.id, c.title]));
      let pending = 0;
      const outline = layout.map((entry) => ({
        id: entry.chapterId,
        title: titles.get(entry.chapterId) ?? '',
        lessons: entry.lessonIds.map((id) => {
          const l = byId.get(id)!;
          const draft = (l.draft as Partial<LessonFields> | null) ?? null;
          const hasChanges = l.status === 'DRAFT' || !!draft;
          if (hasChanges) pending++;
          return {
            id: l.id,
            title: draft?.title ?? l.title,
            kind: draft?.kind ?? l.kind,
            preview: draft?.preview ?? l.preview,
            practice: draft?.practice ?? l.practice,
            status: l.status,
            has_draft: !!draft,
            has_file: !!l.storage_path,
            revision: l.revision,
            progress_count: l._count.progress,
          };
        }),
      }));
      return { chapters: outline, pending_changes: pending };
    });
  }

  saveCurriculum(user: CurrentUser, courseId: string, dto: CurriculumDto) {
    return this.db.atomic(async (tx) => {
      const course = await this.courses.assertOwner(user, courseId, tx);
      const current = await currentLayout(tx, courseId);
      const chapterIds = current.map((c) => c.chapterId).sort();
      const lessonIds = current.flatMap((c) => c.lessonIds).sort();
      const sentChapters = dto.chapters.map((c) => c.id);
      const sentLessons = dto.chapters.flatMap((c) => c.lesson_ids);
      const same = (a: string[], b: string[]) =>
        a.length === b.length &&
        new Set(b).size === b.length &&
        [...b].sort().every((v, i) => v === a[i]);
      if (!same(chapterIds, sentChapters) || !same(lessonIds, sentLessons))
        throw new ConflictException(
          'The course outline changed in another editor. Reload and try again.',
        );
      await applyLayout(
        tx,
        courseId,
        dto.chapters.map((c) => ({ chapterId: c.id, lessonIds: c.lesson_ids })),
      );
      await audit(tx, {
        actor: user,
        target: course.instructor_id,
        action: 'CURRICULUM_REORDERED',
        description: `Course outline reordered: ${course.title}`,
        resourceType: 'COURSE',
        resourceId: courseId,
      });
      return { saved: true };
    });
  }

  createChapter(user: CurrentUser, courseId: string, title: string) {
    return this.db.atomic(async (tx) => {
      await this.courses.assertOwner(user, courseId, tx);
      const name = title.trim();
      if (await tx.chapter.findFirst({ where: { course_id: courseId, title: name } }))
        throw new ConflictException('A chapter with this name already exists');
      const last = await tx.chapter.findFirst({
        where: { course_id: courseId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      return tx.chapter.create({
        data: { course_id: courseId, title: name, position: (last?.position ?? -1) + 1 },
        select: { id: true, title: true },
      });
    });
  }

  renameChapter(user: CurrentUser, id: string, title: string) {
    return this.db.atomic(async (tx) => {
      const { chapter, course } = await this.chapterFor(user, id, tx);
      const name = title.trim();
      if (
        await tx.chapter.findFirst({
          where: { course_id: chapter.course_id, title: name, id: { not: id } },
        })
      )
        throw new ConflictException('A chapter with this name already exists');
      await tx.chapter.update({ where: { id }, data: { title: name } });
      // The learner view groups by the denormalized chapter name.
      await tx.lesson.updateMany({ where: { chapter_id: id }, data: { chapter: name } });
      await audit(tx, {
        actor: user,
        target: course.instructor_id,
        action: 'CHAPTER_RENAMED',
        description: `Chapter renamed in ${course.title}`,
        resourceType: 'COURSE',
        resourceId: course.id,
        oldValues: { title: chapter.title },
        newValues: { title: name },
      });
      return { id, title: name };
    });
  }

  deleteChapter(user: CurrentUser, id: string) {
    return this.db.atomic(async (tx) => {
      const { chapter } = await this.chapterFor(user, id, tx);
      if (await tx.lesson.count({ where: { chapter_id: id } }))
        throw new ConflictException(
          'Move or delete the topics in this chapter first',
        );
      const layout = (await currentLayout(tx, chapter.course_id)).filter(
        (c) => c.chapterId !== id,
      );
      await tx.chapter.delete({ where: { id } });
      await applyLayout(tx, chapter.course_id, layout);
      return { deleted: true };
    });
  }

  // ---------- Lessons ----------

  async lesson(user: CurrentUser, id: string) {
    const { lesson } = await this.lessonFor(user, id, this.db);
    const view = effectiveLesson(asFields(lesson));
    const { storage_path, draft, ...rest } = view;
    return { ...rest, has_file: !!storage_path, has_draft: !!draft };
  }

  createLesson(user: CurrentUser, courseId: string, dto: CreateLessonDto) {
    return this.db.atomic(async (tx) => {
      const course = await this.courses.assertOwner(user, courseId, tx);
      const chapter = await tx.chapter.findFirst({
        where: { id: dto.chapter_id, course_id: courseId },
      });
      if (!chapter) throw new NotFoundException('Chapter not found');
      const layout = await currentLayout(tx, courseId);
      const last = await tx.lesson.findFirst({
        where: { course_id: courseId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const lesson = await tx.lesson.create({
        data: {
          course_id: courseId,
          chapter_id: chapter.id,
          chapter: chapter.title,
          title: dto.title.trim(),
          kind: dto.kind,
          position: (last?.position ?? -1) + 1,
          content: '',
          status: 'DRAFT',
        },
        select: { id: true },
      });
      layout.find((c) => c.chapterId === chapter.id)!.lessonIds.push(lesson.id);
      await applyLayout(tx, courseId, layout);
      await audit(tx, {
        actor: user,
        target: course.instructor_id,
        action: 'LESSON_CREATED',
        description: `Draft topic created: ${dto.title.trim()}`,
        resourceType: 'LESSON',
        resourceId: lesson.id,
      });
      return lesson;
    });
  }

  saveDraft(user: CurrentUser, id: string, dto: LessonDraftDto) {
    return this.db.atomic(async (tx) => {
      const { lesson } = await this.lessonFor(user, id, tx);
      if (dto.expected_revision !== lesson.revision)
        throw new ConflictException(
          'This topic changed in another editor. Reload it before saving.',
        );
      const fields: LessonFields = {
        title: dto.title,
        kind: dto.kind,
        preview: dto.preview,
        practice: dto.kind === 'QUIZ' && dto.practice,
        content: dto.content,
        quiz: dto.kind === 'QUIZ' ? (dto.quiz ?? []) : null,
      };
      const data: Prisma.LessonUpdateInput =
        lesson.status === 'DRAFT'
          ? {
              ...fields,
              quiz: fields.quiz
                ? (fields.quiz as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
              revision: { increment: 1 },
            }
          : {
              draft: fields as unknown as Prisma.InputJsonValue,
              revision: { increment: 1 },
            };
      const saved = await tx.lesson.update({
        where: { id },
        data,
        select: { id: true, revision: true, status: true, draft: true },
      });
      return {
        id: saved.id,
        revision: saved.revision,
        status: saved.status,
        has_draft: !!saved.draft,
        saved_at: new Date().toISOString(),
      };
    });
  }

  discardDraft(user: CurrentUser, id: string) {
    return this.db.atomic(async (tx) => {
      const { lesson } = await this.lessonFor(user, id, tx);
      if (lesson.status === 'DRAFT')
        throw new BadRequestException(
          'This topic has never been published; delete it instead',
        );
      return tx.lesson.update({
        where: { id },
        data: { draft: Prisma.DbNull, revision: { increment: 1 } },
        select: { id: true, revision: true },
      });
    });
  }

  duplicateLesson(user: CurrentUser, id: string) {
    return this.db.atomic(async (tx) => {
      const { lesson, course } = await this.lessonFor(user, id, tx);
      const source = effectiveLesson(asFields(lesson));
      const layout = await currentLayout(tx, lesson.course_id);
      const last = await tx.lesson.findFirst({
        where: { course_id: lesson.course_id },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const chapter = await tx.chapter.findUniqueOrThrow({
        where: { id: lesson.chapter_id! },
      });
      const file = copyPrivateFile(lesson.storage_path);
      const copy = await tx.lesson.create({
        data: {
          course_id: lesson.course_id,
          chapter_id: chapter.id,
          chapter: chapter.title,
          title: `${source.title} (copy)`.slice(0, 160),
          kind: source.kind,
          preview: false,
          practice: source.practice,
          content: source.content,
          quiz: source.quiz
            ? (source.quiz as unknown as Prisma.InputJsonValue)
            : Prisma.DbNull,
          storage_path: file,
          position: (last?.position ?? -1) + 1,
          status: 'DRAFT',
        },
        select: { id: true },
      });
      const entry = layout.find((c) => c.chapterId === chapter.id)!;
      entry.lessonIds.splice(entry.lessonIds.indexOf(id) + 1, 0, copy.id);
      await applyLayout(tx, lesson.course_id, layout);
      await audit(tx, {
        actor: user,
        target: course.instructor_id,
        action: 'LESSON_DUPLICATED',
        description: `Topic duplicated: ${source.title}`,
        resourceType: 'LESSON',
        resourceId: copy.id,
        metadata: { source_lesson_id: id },
      });
      return copy;
    });
  }

  async deleteLesson(user: CurrentUser, id: string) {
    const removed = await this.db.atomic(async (tx) => {
      const { lesson, course } = await this.lessonFor(user, id, tx);
      const layout = (await currentLayout(tx, lesson.course_id)).map((c) => ({
        ...c,
        lessonIds: c.lessonIds.filter((l) => l !== id),
      }));
      const progress = await tx.learningProgress.deleteMany({
        where: { lesson_id: id },
      });
      await tx.lesson.delete({ where: { id } });
      await applyLayout(tx, lesson.course_id, layout);
      await audit(tx, {
        actor: user,
        target: course.instructor_id,
        action: 'LESSON_DELETED',
        description: `Topic deleted: ${lesson.title}`,
        resourceType: 'LESSON',
        resourceId: id,
        oldValues: { title: lesson.title, kind: lesson.kind, status: lesson.status },
        metadata: { removed_progress_records: progress.count },
      });
      return { storage: lesson.storage_path, progress: progress.count };
    });
    removePrivateFile(removed.storage);
    return { deleted: true, removed_progress_records: removed.progress };
  }

  // ---------- Readiness & publishing ----------

  async readiness(
    user: CurrentUser,
    courseId: string,
    tx: Prisma.TransactionClient = this.db,
  ) {
    await this.courses.assertOwner(user, courseId, tx);
    const course = await tx.course.findUniqueOrThrow({
      where: { id: courseId },
      include: {
        thumbnail: { select: { course_id: true } },
        chapters: { select: { id: true, title: true, _count: { select: { lessons: true } } } },
        lessons: { select: lessonSelect, orderBy: { position: 'asc' } },
      },
    });
    const errors: Issue[] = [],
      warnings: Issue[] = [];
    const pending = course.lessons.filter(
      (l) => l.status === 'DRAFT' || l.draft,
    );
    // Publishing a draft course publishes every topic; a live course is judged on what students see.
    const scope = course.published
      ? course.lessons.filter((l) => l.status === 'PUBLISHED').map(asFields)
      : course.lessons.map((l) => effectiveLesson(asFields(l)));
    if (course.archived_at)
      errors.push({ code: 'ARCHIVED', message: 'Restore the course before publishing', tab: 'settings' });
    if (!scope.length)
      errors.push({ code: 'NO_CONTENT', message: 'Add at least one topic', tab: 'chapters' });
    for (const lesson of scope)
      for (const p of lessonProblems(lesson))
        errors.push({ ...p, tab: 'chapters', lesson_id: lesson.id });
    if (course.published)
      for (const lesson of pending)
        for (const p of lessonProblems(effectiveLesson(asFields(lesson))))
          warnings.push({
            code: 'DRAFT_' + p.code,
            message: `Unpublished change: ${p.message}`,
            tab: 'chapters',
            lesson_id: lesson.id,
          });
    if (course.description.trim().length < 50)
      warnings.push({ code: 'DESCRIPTION', message: 'Write a course description of at least 50 characters', tab: 'settings' });
    if (!course.thumbnail)
      warnings.push({ code: 'THUMBNAIL', message: 'Add a thumbnail so the course stands out in the catalog', tab: 'settings' });
    if (course.price_minor > 0 && !scope.some((l) => l.preview))
      warnings.push({ code: 'NO_PREVIEW', message: 'Mark at least one topic as a free preview', tab: 'chapters' });
    for (const lesson of scope)
      if (lesson.kind === 'TEXT' && lesson.content.trim().length < 20)
        warnings.push({ code: 'THIN_TEXT', message: `"${lesson.title}" has very little content`, tab: 'chapters', lesson_id: lesson.id });
    for (const chapter of course.chapters)
      if (!chapter._count.lessons)
        warnings.push({ code: 'EMPTY_CHAPTER', message: `Chapter "${chapter.title}" has no topics`, tab: 'chapters' });
    if (course.published && pending.length)
      warnings.push({
        code: 'PENDING_CHANGES',
        message: `${pending.length} topic${pending.length === 1 ? ' has' : 's have'} unpublished changes`,
        tab: 'chapters',
      });
    return {
      ready: errors.length === 0,
      published: course.published,
      pending_changes: pending.length,
      errors,
      warnings,
    };
  }

  /** Apply drafts in one transaction. Returns how many topics went live, split by new/updated. */
  private async applyDrafts(
    tx: Prisma.TransactionClient,
    courseId: string,
    lessonIds?: string[],
  ) {
    const pending = await tx.lesson.findMany({
      where: {
        course_id: courseId,
        ...(lessonIds ? { id: { in: lessonIds } } : {}),
        OR: [{ status: 'DRAFT' }, { NOT: { draft: { equals: Prisma.DbNull } } }],
      },
      select: lessonSelect,
    });
    const problems = pending.flatMap((l) =>
      lessonProblems(effectiveLesson(asFields(l))).map((p) => p.message),
    );
    if (problems.length)
      throw new ConflictException(
        'Fix these topics before publishing: ' + problems.join('; '),
      );
    const now = new Date();
    let created = 0,
      updated = 0;
    for (const lesson of pending) {
      const next = effectiveLesson(asFields(lesson));
      if (lesson.status === 'DRAFT') created++;
      else updated++;
      await tx.lesson.update({
        where: { id: lesson.id },
        data: {
          title: next.title,
          kind: next.kind,
          preview: next.preview,
          practice: next.kind === 'QUIZ' && next.practice,
          content: next.content,
          quiz:
            next.kind === 'QUIZ' && next.quiz
              ? (next.quiz as unknown as Prisma.InputJsonValue)
              : Prisma.DbNull,
          draft: Prisma.DbNull,
          status: 'PUBLISHED',
          published_at: now,
          revision: { increment: 1 },
        },
      });
    }
    return { created, updated, titles: pending.map((l) => effectiveLesson(asFields(l)).title) };
  }

  publishChanges(user: CurrentUser, courseId: string, lessonIds?: string[]) {
    return this.db.atomic(async (tx) => {
      const course = await this.courses.assertOwner(user, courseId, tx);
      const result = await this.applyDrafts(tx, courseId, lessonIds);
      const total = result.created + result.updated;
      if (!total) return { published: 0 };
      await audit(tx, {
        actor: user,
        target: course.instructor_id,
        action: 'COURSE_CONTENT_PUBLISHED',
        description: `${total} topic change${total === 1 ? '' : 's'} published in ${course.title}`,
        resourceType: 'COURSE',
        resourceId: courseId,
        metadata: { created: result.created, updated: result.updated },
      });
      // One notification per deliberate publish instead of one per keystroke-save.
      await notifyCourse(tx, courseId, {
        event_key: `content:${courseId}:${randomUUID()}`,
        kind: 'CONTENT',
        title:
          total === 1
            ? `${result.created ? 'New topic' : 'Topic updated'}: ${result.titles[0]}`
            : `${course.title}: ${[
                result.created && `${result.created} new`,
                result.updated && `${result.updated} updated`,
              ]
                .filter(Boolean)
                .join(', ')} topics`,
        message: 'New learning content is available in your course.',
        href: `/learn/${courseId}`,
      });
      return { published: total, ...result };
    });
  }

  publishCourse(user: CurrentUser, courseId: string, published: boolean) {
    return this.db.atomic(async (tx) => {
      const course = await this.courses.assertOwner(user, courseId, tx);
      if (course.published === published)
        return { id: courseId, published };
      if (published) {
        const check = await this.readiness(user, courseId, tx);
        if (!check.ready)
          throw new ConflictException(
            'Fix these issues before publishing: ' +
              check.errors.map((e) => e.message).join('; '),
          );
        // First launch: every drafted topic goes live with the course, without per-topic notifications.
        await this.applyDrafts(tx, courseId);
      }
      await tx.course.update({ where: { id: courseId }, data: { published } });
      await audit(tx, {
        actor: user,
        target: course.instructor_id,
        action: published ? 'COURSE_PUBLISHED' : 'COURSE_UNPUBLISHED',
        description: `Course ${published ? 'published' : 'unpublished'}: ${course.title}`,
        resourceType: 'COURSE',
        resourceId: courseId,
      });
      return { id: courseId, published };
    });
  }
}
