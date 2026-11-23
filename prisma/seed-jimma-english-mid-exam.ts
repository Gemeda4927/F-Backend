import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { validateBank } from '../src/modules/assessments/questions.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const sourcePath = process.env.JIMMA_ENGLISH_MID_SOURCE ??
  'C:/Users/HP/AppData/Roaming/Code/agentSessionData/83eb4684-0124-402c-8b28-bd48848b5219/attachments/479852e8-2691-4ef0-b214-90542d577e99/Pasted text #1.txt';
if (!existsSync(sourcePath)) throw new Error(`Jimma English source not found: ${sourcePath}`);
const year = process.env.JIMMA_ENGLISH_MID_YEAR ?? '2026';
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30000,
  }),
});

function id(key: string) {
  const hex = createHash('sha256').update(`learnova:jimma-english-mid:${year}:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
type AnyRecord = Record<string, any>;
const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as AnyRecord;
const reading = source.reading ?? {};
const grammar = source.grammar ?? {};
const bank: AnyRecord[] = [];

function addShort(section: string, item: AnyRecord, index: number, answer: unknown, extra = '') {
  const answerText = Array.isArray(answer) ? answer.join(' / ') : String(answer ?? 'Answer unavailable');
  bank.push({
    id: `jimma-english-mid-${bank.length + 1}`,
    type: 'SHORT',
    question: item.question ?? item.statement ?? `Question ${item.number ?? index}: original wording unavailable in the supplied source`,
    points: 1,
    difficulty: 'MEDIUM',
    explanation: [item.explanation, item.rule, item.source_status, extra].filter(Boolean).join(' '),
    grading_mode: 'MANUAL',
    model_answer: answerText,
  });
}

for (const item of reading.true_false?.questions ?? []) {
  bank.push({
    id: `jimma-english-mid-${bank.length + 1}`,
    type: 'BOOLEAN',
    question: item.statement ?? `True/False question ${item.number}: statement unavailable in the supplied source`,
    points: 1,
    difficulty: 'EASY',
    explanation: item.explanation ?? 'The original statement was not visible in the supplied pages.',
    correct_boolean: Boolean(item.answer),
  });
}
for (const item of reading.multiple_choice?.questions ?? []) {
  bank.push({
    id: `jimma-english-mid-${bank.length + 1}`,
    type: 'MCQ',
    question: item.question,
    points: 1,
    difficulty: 'MEDIUM',
    explanation: item.study_tip ?? 'Use the passage evidence and review each option explanation.',
    options: item.options.map((option: AnyRecord) => ({
      id: String(option.key).toLowerCase(),
      text: option.text,
      explanation: option.explanation ?? '',
    })),
    correct: [String(item.correct_answer).toLowerCase()],
  });
}
for (const item of reading.reference_questions?.questions ?? [])
  addShort('Reference questions', item, item.number, item.correct_answer);
for (const item of reading.guessing_meaning?.questions ?? [])
  addShort('Guessing meaning', item, item.number, item.answer, reading.guessing_meaning.note);
for (const item of grammar.modal_answers?.questions ?? [])
  addShort('Modal verbs', item, item.number, item.answer);
for (const item of grammar.present_perfect_and_simple_past?.questions ?? [])
  addShort('Tenses', item, item.number, item.answer);
for (const item of grammar.conditionals?.questions ?? [])
  addShort('Conditionals', item, item.number, item.answer, grammar.conditionals.general_rule);

validateBank(bank, true);
const title = `Jimma English Mid Exam — ${year} (Set 02)`;
const content = [
  `${reading.title ?? 'Reading: Kenyan Flowers and Environmental Impact'}`,
  JSON.stringify(reading, null, 2),
  `${grammar.title ?? 'Grammar'}`,
  JSON.stringify(grammar, null, 2),
  'SOURCE LIMITATIONS',
  JSON.stringify(source.source_limitations ?? {}, null, 2),
].join('\n\n');

try {
  const instructor = await db.user.findFirst({ where: { role: 'INSTRUCTOR', active: true }, orderBy: { created_at: 'asc' } });
  if (!instructor) throw new Error('No active instructor account exists');
  const course = await db.course.upsert({
    where: { id: id('course') },
    create: {
      id: id('course'), instructor_id: instructor.id, title,
      description: 'Jimma English mid-exam practice covering Kenyan flowers, environmental reading comprehension, vocabulary, modal verbs, tenses, and conditionals. Includes source-completeness notes.',
      category: 'English Language', price_minor: 0, currency: 'ETB', published: true, visibility: 'PUBLIC',
    },
    update: {
      instructor_id: instructor.id, title,
      description: 'Jimma English mid-exam practice covering Kenyan flowers, environmental reading comprehension, vocabulary, modal verbs, tenses, and conditionals. Includes source-completeness notes.',
      category: 'English Language', price_minor: 0, currency: 'ETB', published: true, visibility: 'PUBLIC', archived_at: null,
    },
  });
  await db.lesson.upsert({
    where: { course_id_position: { course_id: course.id, position: 0 } },
    create: { id: id('lesson'), course_id: course.id, title: 'Kenyan flowers reading and grammar notes', chapter: title, position: 0, kind: 'TEXT', preview: true, content, status: 'PUBLISHED' },
    update: { title: 'Kenyan flowers reading and grammar notes', chapter: title, kind: 'TEXT', preview: true, content, status: 'PUBLISHED' },
  });
  const assessment = await db.assessment.upsert({
    where: { id: id('assessment') },
    create: {
      id: id('assessment'), course_id: course.id, title, kind: 'EXAM',
      prompt: 'Complete the 46-question Jimma English mid-exam practice set. Questions whose original wording was missing are clearly labeled.',
      questions: [], question_bank: bank as Prisma.InputJsonValue, structured: true, published: true,
      chapter: title, passing_percent: 60, review_policy: 'AFTER_SUBMISSION', randomize_questions: false,
      randomize_options: false, allow_navigation: true, allow_resume: true, practice: true,
      revision: 1, max_score: bank.length, max_attempts: 3, results_published: true, allow_files: false,
    },
    update: {
      course_id: course.id, prompt: 'Complete the 46-question Jimma English mid-exam practice set. Questions whose original wording was missing are clearly labeled.',
      question_bank: bank as Prisma.InputJsonValue, structured: true, published: true, max_score: bank.length,
    },
  });
  await db.auditLog.create({ data: {
    action: 'COURSE_CONTENT_SEEDED', resource_type: 'COURSE', resource_id: course.id,
    description: `Seeded ${title} from supplied partial exam and answer key.`,
    metadata: { source: sourcePath, year, questions: bank.length, assessment_id: assessment.id } as Prisma.InputJsonValue,
  } });
  console.log(JSON.stringify({ courseId: course.id, assessmentId: assessment.id, questions: bank.length, year }));
} finally {
  await db.$disconnect();
}
