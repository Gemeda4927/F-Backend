import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourcePath =
  process.env.AI_CHAPTER_SOURCE_PATH ||
  'C:\\Users\\HP\\AppData\\Roaming\\Code\\agentSessionData\\bec61038-0509-4e38-ac48-26f36dfe03ae\\attachments\\4c12e629-2967-4c93-941c-11e44683ba74\\Pasted text #1.txt';
if (!existsSync(sourcePath))
  throw new Error(`AI chapter source file not found: ${sourcePath}`);

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30_000,
  }),
});

function stableId(key: string) {
  const h = createHash('sha256')
    .update(`learnova:ai-chapter-one:${key}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const questions = [
  {
    question: 'What is Artificial Intelligence?',
    options: [
      'A programming language',
      'A field focused on developing intelligent computer systems',
      'A hardware component',
      'A database management system',
    ],
    correctIndex: 1,
  },
  {
    question: 'Which is a subset of Artificial Intelligence?',
    options: ['Machine Learning', 'HTML', 'CSS', 'Computer Networking'],
    correctIndex: 0,
  },
  {
    question: 'Which branch focuses on processing human language?',
    options: [
      'Computer Vision',
      'Robotics',
      'Natural Language Processing',
      'Database Management',
    ],
    correctIndex: 2,
  },
  {
    question:
      'How does supervised machine learning differ from traditional programming?',
    options: [
      'It does not use computers.',
      'It never requires data.',
      'It learns patterns from labeled examples instead of relying only on explicit rules.',
      'The approaches are identical.',
    ],
    correctIndex: 2,
  },
  {
    question: 'Which is an application of Computer Vision?',
    options: [
      'Image recognition',
      'File compression',
      'Network routing',
      'Database indexing',
    ],
    correctIndex: 0,
  },
  {
    question: 'What does AGI describe?',
    options: [
      'Task-specific AI',
      'Hypothetical broad human-level intelligence',
      'HTML',
      'SQL',
    ],
    correctIndex: 1,
  },
  {
    question: 'Which is a challenge associated with AI?',
    options: [
      'Data bias',
      'Guaranteed perfect accuracy',
      'Unlimited computational resources',
      'Elimination of all security risks',
    ],
    correctIndex: 0,
  },
  {
    question: 'Deep Learning is a subset of what?',
    options: [
      'Operating systems',
      'Computer networks',
      'Machine Learning',
      'Web development',
    ],
    correctIndex: 2,
  },
];

async function main() {
  const content = readFileSync(resolve(sourcePath), 'utf8')
    .replace(/^\uFEFF/, '')
    .trim();
  if (!content) throw new Error('The AI chapter source file is empty');
  const summary = {
    course: 'reused' as 'created' | 'reused',
    chapter: 'reused' as 'created' | 'reused',
    lesson: 'reused' as 'created' | 'reused',
    assessment: 'reused' as 'created' | 'reused',
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
                'A beginner-friendly introduction to Artificial Intelligence.',
              category: 'Artificial Intelligence',
              price_minor: 0,
              currency: 'ETB',
              published: true,
              visibility: 'PUBLIC',
            },
          });
          summary.course = 'created';
        }

        let chapter = await tx.chapter.findFirst({
          where: {
            course_id: course.id,
            title: 'Chapter One: Introduction to Artificial Intelligence',
          },
        });
        if (!chapter) {
          const last = await tx.chapter.findFirst({
            where: { course_id: course.id },
            orderBy: { position: 'desc' },
            select: { position: true },
          });
          chapter = await tx.chapter.create({
            data: {
              id: stableId('chapter'),
              course_id: course.id,
              title: 'Chapter One: Introduction to Artificial Intelligence',
              position: (last?.position ?? -1) + 1,
            },
          });
          summary.chapter = 'created';
        }

        const lessonId = stableId('lesson');
        const existingLesson = await tx.lesson.findUnique({
          where: { id: lessonId },
        });
        if (
          !existingLesson ||
          !(await tx.learningProgress.count({ where: { lesson_id: lessonId } }))
        ) {
          await tx.lesson.upsert({
            where: { id: lessonId },
            create: {
              id: lessonId,
              course_id: course.id,
              chapter_id: chapter.id,
              chapter: chapter.title,
              title: 'Chapter One: Introduction to Artificial Intelligence',
              position: chapter.position,
              kind: 'TEXT',
              preview: false,
              content,
            },
            update: {
              chapter_id: chapter.id,
              chapter: chapter.title,
              title: 'Chapter One: Introduction to Artificial Intelligence',
              kind: 'TEXT',
              content,
            },
          });
          summary.lesson = existingLesson ? 'reused' : 'created';
        }

        const assessmentId = stableId('assessment');
        const hasSubmissions = await tx.assessmentSubmission.count({
          where: { assessment_id: assessmentId },
        });
        const existingAssessment = await tx.assessment.findUnique({
          where: { id: assessmentId },
        });
        if (!hasSubmissions) {
          await tx.assessment.upsert({
            where: { id: assessmentId },
            create: {
              id: assessmentId,
              course_id: course.id,
              title: 'Chapter One AI review questions',
              kind: 'EXAM',
              chapter: chapter.title,
              prompt:
                'Review assessment for Chapter One: Introduction to Artificial Intelligence.',
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
              title: 'Chapter One AI review questions',
              chapter: chapter.title,
              prompt:
                'Review assessment for Chapter One: Introduction to Artificial Intelligence.',
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
          summary.assessment = existingAssessment ? 'reused' : 'created';
        }
        await tx.course.update({
          where: { id: course.id },
          data: {
            published: true,
            visibility: 'PUBLIC',
            price_minor: 0,
            category: 'Artificial Intelligence',
            archived_at: null,
          },
        });
        await tx.auditLog.create({
          data: {
            action: 'COURSE_CONTENT_SEEDED',
            resource_type: 'COURSE',
            resource_id: course.id,
            description:
              'Seeded Chapter One: Introduction to Artificial Intelligence from supplied pasted text.',
            metadata: {
              source: sourcePath,
              chapter: chapter.title,
              questions: questions.length,
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
