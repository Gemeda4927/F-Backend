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
const bank: AnyRecord[] = [];

for (const item of (reading.true_false?.questions ?? []).filter(
  (candidate: AnyRecord) => typeof candidate.statement === 'string' && candidate.statement.trim(),
)) {
  bank.push({
    id: `jimma-english-mid-${bank.length + 1}`,
    type: 'BOOLEAN',
    question: item.statement,
    points: 1,
    difficulty: 'EASY',
    explanation: item.explanation ?? 'The original statement was not visible in the supplied pages.',
    correct_boolean: Boolean(item.answer),
  });
}
for (const item of (reading.multiple_choice?.questions ?? []).filter(
  (candidate: AnyRecord) => typeof candidate.question === 'string' && candidate.question.trim() && Array.isArray(candidate.options),
)) {
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

validateBank(bank, true);
const title = `Jimma English Mid Exam — ${year} (Set 02)`;
const courseDescription = `# Jimma English Mid Exam

## Practice smart, learn better, succeed

Prepare confidently for the Jimma University English midterm examination with practice questions, detailed explanations, and useful study materials.

## Exam topics

- **Reading comprehension:** Main ideas, passage analysis, and reference questions.
- **Vocabulary:** Word meanings, synonyms, and contextual understanding.
- **True/False:** Evaluate statements based on reading passages.
- **Modal verbs:** Should, might, ought to, and had better.
- **English tenses:** Present perfect and past simple.
- **Conditional sentences:** First, second, and third conditionals.

## Exam features

- Previous examination questions.
- Multiple-choice and grammar exercises.
- Correct answers with detailed explanations.
- Reasons why incorrect answers are wrong.
- Grammar rules with practical examples.
- Vocabulary definitions and study tips.
- Clear, organized learning materials.

## Who should take this exam?

- Jimma University students.
- First-year students.
- Students preparing for English midterm exams.
- Anyone improving their English skills.

## Learning objectives

By completing this exam, you will be able to:

1. Understand and analyze English reading passages.
2. Identify correct grammar structures.
3. Apply tenses and conditional sentences accurately.
4. Improve vocabulary and comprehension skills.
5. Learn from mistakes using detailed explanations.
6. Build confidence for your actual examination.

## Study tip

Do not just memorize answers. Understand why each answer is correct and why the other options are wrong.

**Study smart. Practice more. Prepare with confidence.**`;
const readingOverview = (reading.passage_excerpt ?? [])
  .map((item: AnyRecord) => `### ${item.topic}\n\n${item.text}`)
  .join('\n\n');
const examPrompt = [
  `# ${reading.title ?? 'Kenyan Flowers and Environmental Impact'}`,
  readingOverview,
  '## Instructions',
  `Read the passage carefully and answer the ${bank.length} questions below.`,
].join('\n\n');
const content = '# Exam preparation\n\nRead the passage in the exam, then answer the questions below it.';

try {
  const instructor = await db.user.findFirst({ where: { role: 'INSTRUCTOR', active: true }, orderBy: { created_at: 'asc' } });
  if (!instructor) throw new Error('No active instructor account exists');
  const course = await db.course.upsert({
    where: { id: id('course') },
    create: {
      id: id('course'), instructor_id: instructor.id, title,
      description: courseDescription,
      category: 'English Language', price_minor: 0, currency: 'ETB', published: true, visibility: 'PUBLIC',
    },
    update: {
      instructor_id: instructor.id, title,
      description: courseDescription,
      category: 'English Language', price_minor: 0, currency: 'ETB', published: true, visibility: 'PUBLIC', archived_at: null,
    },
  });
  await db.lesson.upsert({
    where: { course_id_position: { course_id: course.id, position: 0 } },
    create: { id: id('lesson'), course_id: course.id, title: 'Exam preparation', chapter: title, position: 0, kind: 'TEXT', preview: true, content, status: 'PUBLISHED' },
    update: { title: 'Exam preparation', chapter: title, kind: 'TEXT', preview: true, content, status: 'PUBLISHED' },
  });
  const assessment = await db.assessment.upsert({
    where: { id: id('assessment') },
    create: {
      id: id('assessment'), course_id: course.id, title, kind: 'EXAM',
      exam_type: 'MID', university: 'Jimma University', campus: 'Jimma Main Campus', department: 'Freshman Program',
      prompt: examPrompt,
      questions: [], question_bank: bank as Prisma.InputJsonValue, structured: true, published: true,
      chapter: title, passing_percent: 60, review_policy: 'AFTER_SUBMISSION', randomize_questions: false,
      randomize_options: false, allow_navigation: true, allow_resume: true, practice: true,
      revision: 1, max_score: bank.length, max_attempts: 3, results_published: true, allow_files: false,
    },
    update: {
      course_id: course.id, prompt: examPrompt,
      exam_type: 'MID', university: 'Jimma University', campus: 'Jimma Main Campus', department: 'Freshman Program',
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
