import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const markdownPath =
  process.env.FLUTTER_COURSE_SOURCE_PATH ||
  'C:\\Users\\HP\\Downloads\\flutter-complete-course.md';
const zipPath =
  process.env.TASKFLOW_SOURCE_PATH || 'C:\\Users\\HP\\Downloads\\taskflow.zip';
if (!existsSync(markdownPath))
  throw new Error(`Flutter course source not found: ${markdownPath}`);
if (!existsSync(zipPath))
  throw new Error(`TaskFlow source archive not found: ${zipPath}`);

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30_000,
  }),
});

function stableId(key: string) {
  const h = createHash('sha256')
    .update(`learnova:flutter-taskflow:${key}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type LessonSeed = {
  key: string;
  title: string;
  content: string;
  preview?: boolean;
};

function parseFlutterLessons(markdown: string): LessonSeed[] {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  const heading = /^##\s+(Chapter\s+\d+\s+[^#]+|Appendix\s+[^#]+)$/;
  const lessons: LessonSeed[] = [];
  let current: LessonSeed = {
    key: 'overview',
    title: 'Course overview and roadmap',
    content: '',
    preview: true,
  };
  for (const line of lines) {
    const match = line.match(heading);
    if (match) {
      lessons.push({ ...current, content: current.content.trim() });
      current = {
        key: match[1].toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        title: match[1].trim(),
        content: `${match[1]}\n\n`,
        preview: lessons.length <= 2,
      };
    } else {
      current.content += `${line}\n`;
    }
  }
  lessons.push({ ...current, content: current.content.trim() });
  return lessons.filter((lesson) => lesson.content.length > 40);
}

function zipText(entry: string) {
  return execFileSync('tar', ['-xOf', zipPath, entry], {
    encoding: 'utf8',
    maxBuffer: 2_000_000,
  });
}

function zipEntries() {
  return execFileSync('tar', ['-tf', zipPath], { encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((entry) => entry && !entry.endsWith('/'));
}

function buildTaskFlowLessons(): LessonSeed[] {
  const entries = zipEntries();
  const files = entries.filter((entry) => entry.startsWith('taskflow/'));
  const readme = zipText('taskflow/README.md');
  const pubspec = zipText('taskflow/pubspec.yaml');
  const sourceFiles = files.filter((entry) => /\.(dart|yaml)$/.test(entry));
  const by = (pattern: RegExp) =>
    sourceFiles.filter((entry) => pattern.test(entry));
  const snippets = (selected: string[]) =>
    selected
      .map(
        (entry) =>
          `### ${entry}\n\n\`\`\`dart\n${zipText(entry).slice(0, 12000)}\n\`\`\``,
      )
      .join('\n\n');
  return [
    {
      key: 'overview',
      title: 'TaskFlow project overview',
      preview: true,
      content: `${readme}\n\n## Included project files\n\n${files.join('\n')}`,
    },
    {
      key: 'setup',
      title: 'TaskFlow setup and dependencies',
      preview: true,
      content: `Use this lesson with the Flutter course setup chapters.\n\n## pubspec.yaml\n\n\`\`\`yaml\n${pubspec}\n\`\`\`\n\n## Project commands\n\n- flutter pub get\n- flutter analyze\n- flutter test\n- flutter run\n\nThe archive contains ${files.length} project files and ${sourceFiles.length} Dart/YAML source files.`,
    },
    {
      key: 'architecture',
      title: 'TaskFlow architecture and shared core',
      content: snippets(by(/taskflow\/(lib\/)?(core|shared)\//).slice(0, 8)),
    },
    {
      key: 'authentication',
      title: 'TaskFlow authentication feature',
      content: snippets(by(/taskflow\/lib\/features\/auth\//)),
    },
    {
      key: 'tasks',
      title: 'TaskFlow tasks, filtering, and persistence',
      content: snippets(
        by(/taskflow\/lib\/features\/(tasks|stats)\//).slice(0, 14),
      ),
    },
    {
      key: 'supporting-features',
      title: 'TaskFlow quotes, settings, and navigation',
      content: snippets(
        by(/taskflow\/lib\/features\/(quotes|settings)\//).concat(
          by(/taskflow\/lib\/core\/router\//),
        ),
      ),
    },
    {
      key: 'testing',
      title: 'TaskFlow testing and quality workflow',
      content: `The project includes unit and widget tests for validators, date formatting, task behavior, Riverpod controllers, and login UI.\n\n${snippets(files.filter((entry) => entry.includes('/test/')))}\n\nRun flutter analyze and flutter test before each release.`,
    },
    {
      key: 'capstone',
      title: 'TaskFlow capstone project checklist',
      content: `Build and explain the complete app from the archive. Demonstrate registration and login, task CRUD, filters and sorting, statistics, theme persistence, quote loading with retry, optimistic updates with rollback, and the test suite.\n\n## Evidence to submit\n\n1. A short architecture diagram.\n2. Screenshots or a recording of the main flows.\n3. Test output from flutter analyze and flutter test.\n4. Two improvements you would make for offline sync, localization, or accessibility.`,
    },
  ];
}

async function findOrCreateCourse(
  tx: Prisma.TransactionClient,
  title: string,
  description: string,
  category: string,
) {
  let course = await tx.course.findFirst({
    where: { title },
    orderBy: { created_at: 'asc' },
  });
  if (course) return { course, created: false };
  const instructor = await tx.user.findFirst({
    where: {
      role: { in: ['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'] },
      active: true,
    },
    orderBy: { created_at: 'asc' },
  });
  if (!instructor)
    throw new Error(
      `No active instructor or administrator exists to own ${title}`,
    );
  const id = stableId(`course:${title}`);
  const existingById = await tx.course.findUnique({ where: { id } });
  course = await tx.course.upsert({
    where: { id },
    create: {
      id,
      instructor_id: instructor.id,
      title,
      description,
      category,
      price_minor: 0,
      currency: 'ETB',
      published: true,
      visibility: 'PUBLIC',
    },
    update: {
      title,
      description,
      category,
      price_minor: 0,
      currency: 'ETB',
      published: true,
      visibility: 'PUBLIC',
      archived_at: null,
    },
  });
  return { course, created: !existingById };
}

async function seedCourse(
  tx: Prisma.TransactionClient,
  options: {
    key: string;
    title: string;
    description: string;
    category: string;
    lessons: LessonSeed[];
  },
) {
  const summary = {
    course: 'reused' as 'created' | 'reused',
    chapters: 0,
    lessons: 0,
  };
  const found = await findOrCreateCourse(
    tx,
    options.title,
    options.description,
    options.category,
  );
  const course = found.course;
  summary.course = found.created ? 'created' : 'reused';
  for (const [position, lesson] of options.lessons.entries()) {
    const chapterTitle =
      lesson.key === 'overview' ? 'Course overview' : lesson.title;
    let chapter = await tx.chapter.findFirst({
      where: { course_id: course.id, title: chapterTitle },
    });
    if (!chapter) {
      chapter = await tx.chapter.create({
        data: {
          id: stableId(`${options.key}:chapter:${lesson.key}`),
          course_id: course.id,
          title: chapterTitle,
          position,
        },
      });
      summary.chapters++;
    }
    const id = stableId(`${options.key}:lesson:${lesson.key}`);
    const existing = await tx.lesson.findUnique({ where: { id } });
    if (
      existing &&
      (await tx.learningProgress.count({ where: { lesson_id: id } }))
    )
      continue;
    await tx.lesson.upsert({
      where: { id },
      create: {
        id,
        course_id: course.id,
        chapter_id: chapter.id,
        chapter: chapter.title,
        title: lesson.title,
        position,
        kind: 'TEXT',
        preview: lesson.preview ?? false,
        content: lesson.content,
      },
      update: {
        chapter_id: chapter.id,
        chapter: chapter.title,
        title: lesson.title,
        position,
        kind: 'TEXT',
        preview: lesson.preview ?? false,
        content: lesson.content,
      },
    });
    summary.lessons++;
  }
  await tx.course.update({
    where: { id: course.id },
    data: {
      description: options.description,
      category: options.category,
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
      description: `Seeded ${options.title}.`,
      metadata: {
        source: options.key,
        lessons: options.lessons.length,
      } as Prisma.InputJsonValue,
    },
  });
  return summary;
}

async function seedAssessment(
  tx: Prisma.TransactionClient,
  courseTitle: string,
  key: string,
  questions: object[],
) {
  const course = await tx.course.findFirstOrThrow({
    where: { title: courseTitle },
    orderBy: { created_at: 'asc' },
  });
  const id = stableId(`${key}:assessment`);
  const existing = await tx.assessment.findUnique({ where: { id } });
  if (
    existing &&
    (await tx.assessmentSubmission.count({ where: { assessment_id: id } }))
  )
    return 'protected';
  await tx.assessment.upsert({
    where: { id },
    create: {
      id,
      course_id: course.id,
      title:
        key === 'flutter'
          ? 'Flutter and Dart fundamentals check'
          : 'TaskFlow capstone review',
      kind: 'EXAM',
      prompt: `Practice assessment for ${courseTitle}.`,
      questions: questions as Prisma.InputJsonValue,
      question_bank: questions as Prisma.InputJsonValue,
      structured: true,
      published: true,
      practice: true,
      max_score: questions.length,
      max_attempts: 3,
    },
    update: {
      questions: questions as Prisma.InputJsonValue,
      question_bank: questions as Prisma.InputJsonValue,
      published: true,
      practice: true,
      max_score: questions.length,
    },
  });
  return existing ? 'reused' : 'created';
}

async function main() {
  const flutterLessons = parseFlutterLessons(
    readFileSync(resolve(markdownPath), 'utf8'),
  );
  const taskflowLessons = buildTaskFlowLessons();
  try {
    await db.$connect();
    await db.$transaction(
      async (tx) => {
        const flutter = await seedCourse(tx, {
          key: 'flutter-complete',
          title: 'Flutter: The Complete Course',
          description:
            'Go from zero to production with Dart, Flutter, architecture, state management, networking, storage, Firebase, testing, performance, CI/CD, publishing, and the TaskFlow capstone.',
          category: 'Mobile Development',
          lessons: flutterLessons,
        });
        const taskflow = await seedCourse(tx, {
          key: 'taskflow-capstone',
          title: 'TaskFlow: Flutter Capstone Project',
          description:
            'Build and study a production-style Flutter task manager using Riverpod, go_router, SQLite, Dio, secure storage, clean architecture, and automated tests.',
          category: 'Mobile Development',
          lessons: taskflowLessons,
        });
        const flutterAssessment = await seedAssessment(
          tx,
          'Flutter: The Complete Course',
          'flutter',
          [
            {
              question: 'Which language does Flutter use?',
              options: ['Dart', 'Kotlin only', 'Swift only', 'JavaScript only'],
              correctIndex: 0,
            },
            {
              question: 'What does hot reload preserve during development?',
              options: [
                'App state where possible',
                'The production database',
                'A signed release build',
                'The app store listing',
              ],
              correctIndex: 0,
            },
            {
              question:
                'Which widget is commonly used for a long lazily built list?',
              options: ['ListView.builder', 'Text', 'Spacer', 'Icon'],
              correctIndex: 0,
            },
            {
              question: 'What is Riverpod used for in this course?',
              options: [
                'State and dependency management',
                'Image compression only',
                'App signing',
                'SQL migrations only',
              ],
              correctIndex: 0,
            },
            {
              question: 'Which command runs Flutter tests?',
              options: [
                'flutter test',
                'flutter ship',
                'dart publish-app',
                'flutter verify-store',
              ],
              correctIndex: 0,
            },
          ],
        );
        const taskflowAssessment = await seedAssessment(
          tx,
          'TaskFlow: Flutter Capstone Project',
          'taskflow',
          [
            {
              question: 'Which local database does TaskFlow use?',
              options: [
                'SQLite through sqflite',
                'MongoDB only',
                'Redis',
                'PostgreSQL',
              ],
              correctIndex: 0,
            },
            {
              question: 'Which state-management package is used?',
              options: ['Riverpod', 'Redux only', 'MobX only', 'None'],
              correctIndex: 0,
            },
            {
              question:
                'What should happen when an optimistic task update fails?',
              options: [
                'Roll back the UI state and show an error',
                'Delete the whole database',
                'Ignore the failure',
                'Sign out every user',
              ],
              correctIndex: 0,
            },
            {
              question:
                'Which command checks the Dart/Flutter code statically?',
              options: [
                'flutter analyze',
                'flutter inspect-store',
                'dart deploy',
                'flutter database',
              ],
              correctIndex: 0,
            },
            {
              question: 'What is required before submitting the capstone?',
              options: [
                'Architecture evidence and passing analysis/tests',
                'Only a screenshot',
                'A paid app-store listing',
                'A production server',
              ],
              correctIndex: 0,
            },
          ],
        );
        console.log(
          JSON.stringify(
            { flutter, taskflow, flutterAssessment, taskflowAssessment },
            null,
            2,
          ),
        );
      },
      { maxWait: 30_000, timeout: 120_000 },
    );
  } finally {
    await db.$disconnect();
  }
}

await main();
