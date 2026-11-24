import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourcePath =
  process.env.AI_SOURCE_PATH ||
  'C:\\Users\\HP\\Downloads\\introduction-to-ai.md';
if (!existsSync(sourcePath))
  throw new Error(`AI source file not found: ${sourcePath}`);

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30_000,
  }),
});

function stableId(key: string) {
  const h = createHash('sha256')
    .update(`learnova:introduction-to-ai:${key}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function parseLessons(markdown: string) {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  const lessons: { title: string; content: string; position: number }[] = [];
  let current: { title: string; content: string; position: number } | undefined;
  for (const line of lines) {
    const heading = line.match(/^##\s+(\d+\.\s+.+)$/);
    if (heading) {
      if (current)
        lessons.push({ ...current, content: current.content.trim() });
      current = {
        title: heading[1].replace(/^\d+\.\s+/, ''),
        content: '',
        position: lessons.length,
      };
      continue;
    }
    if (current) current.content += `${line}\n`;
  }
  if (current) lessons.push({ ...current, content: current.content.trim() });
  if (!lessons.length)
    throw new Error('The AI Markdown did not contain any ## sections');
  return lessons;
}

const questions = [
  {
    question:
      'What is the main difference between traditional programming and machine learning?',
    options: [
      'Traditional programming learns from examples; machine learning uses only rules.',
      'Traditional programming uses explicit rules; machine learning learns patterns from data.',
      'They are identical.',
      'Machine learning cannot make predictions.',
    ],
    correctIndex: 1,
  },
  {
    question: 'Which paradigm learns from labeled input-output examples?',
    options: [
      'Unsupervised learning',
      'Reinforcement learning',
      'Supervised learning',
      'Symbolic AI',
    ],
    correctIndex: 2,
  },
  {
    question: 'What does a neural network adjust during training?',
    options: ['Weights', 'File names', 'Browser tabs', 'Database tables'],
    correctIndex: 0,
  },
  {
    question: 'What is an LLM primarily trained to do?',
    options: [
      'Predict the next token',
      'Replace every database',
      'Guarantee factual answers',
      'Detect every image',
    ],
    correctIndex: 0,
  },
  {
    question: 'Which is a responsible-AI concern?',
    options: [
      'Bias and fairness',
      'Keyboard layout',
      'Screen brightness',
      'Folder naming',
    ],
    correctIndex: 0,
  },
  {
    question: 'What is overfitting?',
    options: [
      'A model that is too simple',
      'A model that memorizes training data and performs poorly on new data',
      'A model with no data',
      'A model that never trains',
    ],
    correctIndex: 1,
  },
];

async function main() {
  const markdown = readFileSync(resolve(sourcePath), 'utf8');
  const lessons = parseLessons(markdown);
  const summary = {
    course: 'reused' as 'created' | 'reused',
    lessons: 0,
    chapters: 0,
    assessments: 0,
  };

  try {
    await db.$connect();
    await db.$transaction(
      async (tx) => {
        let course = await tx.course.findFirst({
          where: { title: 'Introduction to Artificial Intelligence' },
          orderBy: { created_at: 'asc' },
        });
        if (!course) {
          const instructor = await tx.user.findFirst({
            where: {
              role: { in: ['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'] },
              active: true,
            },
            orderBy: { created_at: 'asc' },
          });
          if (!instructor)
            throw new Error(
              'No active instructor or administrator exists to own the AI course',
            );
          course = await tx.course.create({
            data: {
              id: stableId('course'),
              instructor_id: instructor.id,
              title: 'Introduction to Artificial Intelligence',
              description:
                'A beginner-friendly guide to artificial intelligence, machine learning, deep learning, generative AI, applications, tools, ethics, and a practical learning roadmap.',
              category: 'Artificial Intelligence',
              price_minor: 0,
              currency: 'ETB',
              published: true,
              visibility: 'PUBLIC',
            },
          });
          summary.course = 'created';
        }

        for (const lesson of lessons) {
          const chapterTitle = lesson.title;
          let chapter = await tx.chapter.findFirst({
            where: { course_id: course.id, title: chapterTitle },
          });
          if (!chapter) {
            chapter = await tx.chapter.create({
              data: {
                id: stableId(`chapter:${lesson.position}`),
                course_id: course.id,
                title: chapterTitle,
                position: lesson.position,
              },
            });
            summary.chapters++;
          }
          const id = stableId(`lesson:${lesson.position}`);
          const existing = await tx.lesson.findUnique({ where: { id } });
          if (
            existing &&
            (await tx.learningProgress.count({
              where: { lesson_id: existing.id },
            }))
          )
            continue;
          await tx.lesson.upsert({
            where: { id },
            create: {
              id,
              course_id: course.id,
              chapter_id: chapter.id,
              chapter: chapterTitle,
              title: lesson.title,
              position: lesson.position,
              kind: 'TEXT',
              preview: lesson.position === 0,
              content: lesson.content,
            },
            update: {
              chapter_id: chapter.id,
              chapter: chapterTitle,
              title: lesson.title,
              position: lesson.position,
              kind: 'TEXT',
              preview: lesson.position === 0,
              content: lesson.content,
            },
          });
          summary.lessons++;
        }

        const assessmentId = stableId('assessment:knowledge-check');
        const hasSubmissions = await tx.assessmentSubmission.count({
          where: { assessment_id: assessmentId },
        });
        if (!hasSubmissions) {
          await tx.assessment.upsert({
            where: { id: assessmentId },
            create: {
              id: assessmentId,
              course_id: course.id,
              title: 'AI fundamentals knowledge check',
              kind: 'EXAM',
              prompt:
                'Check your understanding of the introductory AI guide. Choose the best answer for each question.',
              questions: questions.map(
                (q) => q.question,
              ) as Prisma.InputJsonValue,
              question_bank: questions as Prisma.InputJsonValue,
              structured: true,
              published: true,
              practice: true,
              max_score: questions.length,
              max_attempts: 3,
            },
            update: {
              title: 'AI fundamentals knowledge check',
              prompt:
                'Check your understanding of the introductory AI guide. Choose the best answer for each question.',
              questions: questions.map(
                (q) => q.question,
              ) as Prisma.InputJsonValue,
              question_bank: questions as Prisma.InputJsonValue,
              published: true,
              practice: true,
              max_score: questions.length,
              max_attempts: 3,
            },
          });
          summary.assessments++;
        }
        await tx.course.update({
          where: { id: course.id },
          data: {
            description:
              'A beginner-friendly guide to artificial intelligence, machine learning, deep learning, generative AI, applications, tools, ethics, and a practical learning roadmap.',
            category: 'Artificial Intelligence',
            price_minor: 0,
            currency: 'ETB',
            published: true,
            visibility: 'PUBLIC',
            archived_at: null,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'COURSE_CONTENT_SEEDED',
            resource_type: 'COURSE',
            resource_id: course.id,
            description:
              'Seeded Introduction to Artificial Intelligence from the supplied Markdown guide.',
            metadata: {
              source: sourcePath,
              lessons: lessons.length,
              assessment: 'AI fundamentals knowledge check',
            } as Prisma.InputJsonValue,
          },
        });
      },
      { maxWait: 30_000, timeout: 120_000 },
    );
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await db.$disconnect();
  }
}

await main();
