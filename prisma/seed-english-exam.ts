import { existsSync, readFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';
import { validateBank } from '../src/modules/assessments/questions.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sourcePath =
  process.env.ENGLISH_EXAM_SOURCE ??
  'C:/Users/HP/AppData/Roaming/Code/agentSessionData/83eb4684-0124-402c-8b28-bd48848b5219/attachments/a92dfab6-cf45-441e-a215-14b4e1d372e2/Pasted text #1.txt';
if (!existsSync(sourcePath)) throw new Error(`English exam source not found: ${sourcePath}`);
const year = process.env.JIMMA_ENGLISH_YEAR ?? '2026';

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30000,
  }),
});

function id(key: string) {
  const hex = createHash('sha256').update(`learnova:english-exam:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type SourceQuestion = Record<string, any>;
type SourceExam = {
  exam: {
    title: string;
    sections: Array<Record<string, any>>;
    study_guide?: Record<string, any>;
  };
};

const source = JSON.parse(readFileSync(sourcePath, 'utf8')) as SourceExam;
const exam = source.exam;
const questions = exam.sections.flatMap((section) =>
  (section.questions ?? []).map((question: SourceQuestion) => ({
    ...question,
    section: section.title,
  })),
);

const bank = questions.map((question, index) => {
  const options = question.options ?? question.generated_practice_options ?? [];
  const correct = options
    .filter((option: SourceQuestion) => option.is_correct)
    .map((option: SourceQuestion) => String(option.key).toLowerCase());
  return {
    id: `english-exam-q-${question.id ?? index + 1}`,
    type: 'MCQ',
    question: question.question,
    points: 1,
    difficulty: String(question.difficulty ?? 'MEDIUM').toUpperCase(),
    options: options.map((option: SourceQuestion) => ({
      id: String(option.key).toLowerCase(),
      text: option.text,
      explanation: option.explanation ?? '',
    })),
    correct,
    explanation: [question.explanation, question.grammar_rule, question.study_tip]
      .filter(Boolean)
      .join(' '),
  };
});

validateBank(bank, true);

const passage = exam.sections
  .filter((section) => section.passage_paragraphs)
  .flatMap((section) => section.passage_paragraphs)
  .map((paragraph: SourceQuestion) => `${paragraph.number}. ${paragraph.text}`)
  .join('\n\n');
const studyGuideText = [
  '## Reading skills',
  ...(exam.study_guide?.reading_skills ?? []).map(
    (item: Record<string, string>) => `### ${item.skill}\n\n${item.description}\n\n**Example:** ${item.example}`,
  ),
  '## Grammar rules',
  ...(exam.study_guide?.grammar_rules ?? []).map(
    (item: Record<string, string>) => `### ${item.topic}\n\n**Structure:** ${item.structure}\n\n**Usage:** ${item.usage}\n\n**Example:** ${item.example}`,
  ),
].join('\n\n');
const courseTitle = `Jimma English Examination — ${year} (Set 01)`;

try {
  const instructor = await db.user.findFirst({
    where: { role: 'INSTRUCTOR', active: true },
    orderBy: { created_at: 'asc' },
  });
  if (!instructor) throw new Error('No active instructor account exists');

  const course = await db.course.upsert({
    where: { id: id('course') },
    create: {
      id: id('course'),
      instructor_id: instructor.id,
      title: courseTitle,
      description: 'A 25-question Jimma English examination with reading comprehension, grammar practice, answer explanations, and a study guide.',
      category: 'English Language',
      price_minor: 0,
      currency: 'ETB',
      published: true,
      visibility: 'PUBLIC',
    },
    update: {
      instructor_id: instructor.id,
      description: 'A 25-question Jimma English examination with reading comprehension, grammar practice, answer explanations, and a study guide.',
      category: 'English Language',
      price_minor: 0,
      currency: 'ETB',
      published: true,
      visibility: 'PUBLIC',
      archived_at: null,
    },
  });

  await db.lesson.upsert({
    where: { course_id_position: { course_id: course.id, position: 0 } },
    create: {
      id: id('lesson'),
      course_id: course.id,
      title: 'Reading passage and study guide',
      chapter: 'English Language Examination',
      position: 0,
      kind: 'TEXT',
      preview: true,
      content: `# The dangers of cramming\n\n${passage}\n\n# Study guide\n\n${studyGuideText}`,
      status: 'PUBLISHED',
    },
    update: {
      title: 'Reading passage and study guide',
      chapter: 'English Language Examination',
      kind: 'TEXT',
      preview: true,
      content: `# The dangers of cramming\n\n${passage}\n\n# Study guide\n\n${studyGuideText}`,
      status: 'PUBLISHED',
    },
  });

  const assessment = await db.assessment.upsert({
    where: { id: id('assessment') },
    create: {
      id: id('assessment'),
      course_id: course.id,
      title: courseTitle,
      kind: 'EXAM',
      prompt: 'Answer all 25 questions. Review the explanation after each response and use the study guide to revise weak areas.',
      questions: [],
      question_bank: bank as Prisma.InputJsonValue,
      structured: true,
      published: true,
      chapter: 'English Language Examination',
      passing_percent: 60,
      review_policy: 'AFTER_SUBMISSION',
      randomize_questions: false,
      randomize_options: false,
      allow_navigation: true,
      allow_resume: true,
      practice: true,
      revision: 1,
      max_score: questions.length,
      max_attempts: 3,
      results_published: true,
      allow_files: false,
    },
    update: {
      course_id: course.id,
      prompt: 'Answer all 25 questions. Review the explanation after each response and use the study guide to revise weak areas.',
      question_bank: bank as Prisma.InputJsonValue,
      structured: true,
      published: true,
      max_score: questions.length,
    },
  });

  await db.auditLog.create({
    data: {
      action: 'COURSE_CONTENT_SEEDED',
      resource_type: 'COURSE',
      resource_id: course.id,
      description: `Seeded ${courseTitle} from supplied study data.`,
      metadata: { source: sourcePath, year, questions: questions.length, assessment_id: assessment.id } as Prisma.InputJsonValue,
    },
  });
  console.log(JSON.stringify({ courseId: course.id, assessmentId: assessment.id, questions: questions.length }));
} finally {
  await db.$disconnect();
}
