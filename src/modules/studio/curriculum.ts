import type { Prisma } from '../../generated/prisma/client.js';

/** Positions are unique per course; this offset moves rows out of the way before rewriting them. */
const PARKING_OFFSET = 1_000_000;
export const DEFAULT_CHAPTER = 'Getting started';

export type Layout = { chapterId: string; lessonIds: string[] }[];

export type QuizQuestion = {
  question: string;
  options: string[];
  correctIndex: number;
  explanation?: string;
};

/** Editable lesson fields. For a published lesson they are held in `draft` until published. */
export type LessonFields = {
  title: string;
  kind: string;
  preview: boolean;
  practice: boolean;
  content: string;
  quiz: QuizQuestion[] | null;
};

/** Find or create the chapter row for a chapter title (used by the legacy lesson endpoints). */
export async function ensureChapter(
  tx: Prisma.TransactionClient,
  courseId: string,
  title: string,
) {
  const name = title.trim() || DEFAULT_CHAPTER;
  const existing = await tx.chapter.findFirst({
    where: { course_id: courseId, title: name },
    orderBy: { position: 'asc' },
  });
  if (existing) return existing;
  const last = await tx.chapter.findFirst({
    where: { course_id: courseId },
    orderBy: { position: 'desc' },
    select: { position: true },
  });
  return tx.chapter.create({
    data: { course_id: courseId, title: name, position: (last?.position ?? -1) + 1 },
  });
}

/** Link lessons that predate chapter rows (seeds, legacy saves) to a chapter. */
export async function syncChapters(
  tx: Prisma.TransactionClient,
  courseId: string,
) {
  const orphans = await tx.lesson.findMany({
    where: { course_id: courseId, chapter_id: null },
    select: { id: true, chapter: true },
    orderBy: { position: 'asc' },
  });
  for (const lesson of orphans) {
    const chapter = await ensureChapter(tx, courseId, lesson.chapter);
    await tx.lesson.update({
      where: { id: lesson.id },
      data: { chapter_id: chapter.id, chapter: chapter.title },
    });
  }
}

/** Current order: chapters by position, lessons by position inside each chapter. */
export async function currentLayout(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<Layout> {
  await syncChapters(tx, courseId);
  const chapters = await tx.chapter.findMany({
    where: { course_id: courseId },
    orderBy: { position: 'asc' },
    select: {
      id: true,
      lessons: { select: { id: true }, orderBy: { position: 'asc' } },
    },
  });
  return chapters.map((c) => ({
    chapterId: c.id,
    lessonIds: c.lessons.map((l) => l.id),
  }));
}

/**
 * Persist a complete layout. Lesson positions become contiguous across the course
 * (0..n-1, chapter by chapter), so the learner view keeps ordering by lesson position.
 */
export async function applyLayout(
  tx: Prisma.TransactionClient,
  courseId: string,
  layout: Layout,
) {
  const chapters = await tx.chapter.findMany({
    where: { course_id: courseId },
    select: { id: true, title: true },
  });
  const titles = new Map(chapters.map((c) => [c.id, c.title]));
  await tx.lesson.updateMany({
    where: { course_id: courseId },
    data: { position: { increment: PARKING_OFFSET } },
  });
  await tx.chapter.updateMany({
    where: { course_id: courseId },
    data: { position: { increment: PARKING_OFFSET } },
  });
  let position = 0;
  for (const [index, entry] of layout.entries()) {
    await tx.chapter.update({
      where: { id: entry.chapterId },
      data: { position: index },
    });
    for (const lessonId of entry.lessonIds)
      await tx.lesson.update({
        where: { id: lessonId },
        data: {
          chapter_id: entry.chapterId,
          chapter: titles.get(entry.chapterId) ?? DEFAULT_CHAPTER,
          position: position++,
        },
      });
  }
}

/** The lesson as it would look once pending draft changes are published. */
export function effectiveLesson<
  T extends LessonFields & { draft: Prisma.JsonValue | null },
>(lesson: T): T {
  const draft = lesson.draft as Partial<LessonFields> | null;
  return draft && typeof draft === 'object' ? { ...lesson, ...draft } : lesson;
}

/** Problems that must be fixed before a lesson can be shown to students. */
export function lessonProblems(lesson: {
  title: string;
  kind: string;
  quiz: unknown;
  storage_path: string | null;
}) {
  const problems: { code: string; message: string }[] = [];
  const name = `"${lesson.title}"`;
  if (lesson.title.trim().length < 2)
    problems.push({ code: 'TITLE', message: 'A topic needs a title' });
  if (['VIDEO', 'PDF'].includes(lesson.kind) && !lesson.storage_path)
    problems.push({
      code: 'MISSING_FILE',
      message: `${name} has no ${lesson.kind === 'PDF' ? 'PDF' : 'video'} uploaded`,
    });
  if (lesson.kind === 'QUIZ') {
    const quiz = Array.isArray(lesson.quiz)
      ? (lesson.quiz as QuizQuestion[])
      : [];
    if (!quiz.length)
      problems.push({ code: 'EMPTY_QUIZ', message: `${name} has no questions` });
    else if (
      quiz.some(
        (q) =>
          !q ||
          typeof q.question !== 'string' ||
          q.question.trim().length < 3 ||
          !Array.isArray(q.options) ||
          q.options.length < 2 ||
          q.options.some((o) => typeof o !== 'string' || !o.trim()) ||
          !Number.isInteger(q.correctIndex) ||
          q.correctIndex < 0 ||
          q.correctIndex >= q.options.length,
      )
    )
      problems.push({
        code: 'INVALID_QUIZ',
        message: `${name} has incomplete questions (each needs text, 2+ answers and a correct answer)`,
      });
  }
  return problems;
}
