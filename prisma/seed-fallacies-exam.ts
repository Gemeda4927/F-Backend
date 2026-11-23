import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { validateBank } from '../src/modules/assessments/questions.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sourcePath = process.env.FALLACIES_EXAM_SOURCE ??
  'C:/Users/HP/AppData/Roaming/Code/agentSessionData/83eb4684-0124-402c-8b28-bd48848b5219/attachments/7d2ecf7a-01f0-4a96-a1d8-97b06ee15786/Pasted text #1.txt';
if (!existsSync(sourcePath)) throw new Error(`Fallacies source not found: ${sourcePath}`);
const year = process.env.FALLACIES_EXAM_YEAR ?? '2026';
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30000,
  }),
});

type RecordValue = Record<string, any>;
const raw = readFileSync(sourcePath, 'utf8').trim();
const source = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, '')) as RecordValue;
const id = (key: string) => {
  const hex = createHash('sha256').update(`learnova:fallacies:${year}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const questions: RecordValue[] = [];
for (const item of source.sections.find((section: RecordValue) => section.id === 'A')?.questions ?? []) {
  questions.push({
    id: `fallacies-${item.id.toLowerCase()}`,
    type: 'BOOLEAN', question: item.statement, points: 1, difficulty: 'EASY',
    explanation: item.explanation, correct_boolean: item.answer,
  });
}
for (const item of source.sections.find((section: RecordValue) => section.id === 'B')?.questions ?? []) {
  questions.push({
    id: `fallacies-${item.id.toLowerCase()}`,
    type: 'MCQ', question: item.question, points: 1, difficulty: 'MEDIUM',
    explanation: item.explanation,
    options: item.options.map((option: RecordValue) => ({
      id: String(option.key).toLowerCase(), text: option.text,
      ...(option.key === item.correctOption ? { explanation: item.explanation } : {}),
    })),
    correct: [String(item.correctOption).toLowerCase()],
  });
}
for (const item of source.sections.find((section: RecordValue) => section.id === 'C')?.questions ?? []) {
  questions.push({
    id: `fallacies-${item.id.toLowerCase()}`,
    type: 'SHORT', question: item.passage, points: 1, difficulty: 'HARD',
    explanation: item.explanation, grading_mode: 'MANUAL', model_answer: item.answer,
  });
}
validateBank(questions, true);

const title = `Fallacies Practice Worksheet — ${year}`;
const sections = source.sections.map((section: RecordValue) =>
  `### ${section.title}\n\n${section.description}\n\n**Instructions:** ${section.instructions}`,
).join('\n\n');
const prompt = [
  `# ${source.title}`,
  `## Logic and Critical Thinking`,
  source.overview.description,
  `### Learning objectives\n\n${source.overview.learningObjectives.map((item: string) => `- ${item}`).join('\n')}`,
  `## Instructions\n\nRead each question carefully. Complete all ${questions.length} questions, then review the explanations after submitting.`,
  `## Sections\n\n${sections}`,
].join('\n\n');
const description = 'A clean practice examination on logical fallacies, critical thinking, argument structure, and common errors in reasoning. It includes True or False, Multiple Choice, and Identify the Fallacy sections with explanations for review.';

try {
  const instructor = await db.user.findFirst({ where: { role: 'INSTRUCTOR', active: true }, orderBy: { created_at: 'asc' } });
  if (!instructor) throw new Error('No active instructor account exists');
  const course = await db.course.upsert({
    where: { id: id('course') },
    create: {
      id: id('course'), instructor_id: instructor.id, title, description,
      category: 'Logic & Critical Thinking', price_minor: 0, currency: 'ETB', published: true, visibility: 'PUBLIC',
    },
    update: {
      instructor_id: instructor.id, title, description, category: 'Logic & Critical Thinking',
      price_minor: 0, currency: 'ETB', published: true, visibility: 'PUBLIC', archived_at: null,
    },
  });
  await db.lesson.upsert({
    where: { course_id_position: { course_id: course.id, position: 0 } },
    create: { id: id('lesson'), course_id: course.id, title: 'Exam overview', chapter: title, position: 0, kind: 'TEXT', preview: true, content: '# Exam overview\n\nReview the examination instructions, then open the exam and answer each section carefully.', status: 'PUBLISHED' },
    update: { title: 'Exam overview', chapter: title, kind: 'TEXT', preview: true, content: '# Exam overview\n\nReview the examination instructions, then open the exam and answer each section carefully.', status: 'PUBLISHED' },
  });
  const assessment = await db.assessment.upsert({
    where: { id: id('assessment') },
    create: {
      id: id('assessment'), course_id: course.id, title, kind: 'EXAM',
      exam_type: 'MID', university: 'Jimma University', campus: 'Jimma Main Campus', department: 'Freshman Program',
      prompt, questions: [], question_bank: questions as Prisma.InputJsonValue, structured: true, published: true,
      chapter: title, passing_percent: 60, review_policy: 'AFTER_SUBMISSION', randomize_questions: false,
      randomize_options: false, allow_navigation: true, allow_resume: true, practice: true,
      revision: 1, max_score: questions.length, max_attempts: 3, results_published: true, allow_files: false,
    },
    update: {
      course_id: course.id, title, prompt, exam_type: 'MID', university: 'Jimma University',
      campus: 'Jimma Main Campus', department: 'Freshman Program', question_bank: questions as Prisma.InputJsonValue,
      structured: true, published: true, max_score: questions.length,
    },
  });
  console.log(JSON.stringify({ courseId: course.id, assessmentId: assessment.id, title, questions: questions.length }));
} finally {
  await db.$disconnect();
}
