import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30_000,
  }),
});

type BankQuestion = { id: string; question: string; [key: string]: unknown };
const source = 'Logic and Critical Thinking, Chapter One: Introducing Philosophy';

function stableId(key: string) {
  const h = createHash('sha256').update(`learnova:phil1011:chapter-one:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const lessons = [
  {
    key: 'meaning-and-nature',
    title: 'Lesson 1: Meaning and Nature of Philosophy',
    pages: '11-15',
    content: `SOURCE MATERIAL\nPhilosophy comes from the Greek words philo, meaning love, and sophia, meaning wisdom. It is therefore commonly understood as the love of wisdom. Philosophy is a disciplined search for truth and understanding, not merely a collection of opinions. It asks careful questions about reality, knowledge, value, meaning, and how human beings ought to live.\n\nPhilosophical questioning examines assumptions that ordinary life often takes for granted. It asks what a claim means, what reasons support it, whether the reasons are sufficient, and what follows if the claim is accepted. Philosophy is also an activity: it involves questioning, reflecting, reasoning, clarifying concepts, and revising beliefs when better reasons are available.\n\nKEY TERMS\nPhilo: love. Sophia: wisdom. Philosophy: the love and disciplined pursuit of wisdom. Philosophical question: a fundamental question investigated through reasoned reflection.\n\nADDITIONAL LEARNING EXAMPLE\nBonsa Tesfaye hears that students who study at night always achieve better grades. He asks what evidence supports the claim and whether it applies to every student. This illustrates philosophical questioning because he examines the meaning, assumptions, and support for the claim instead of accepting it immediately.\n\nKEY TAKEAWAYS\nPhilosophy is a search for truth; it is an activity of rational inquiry; and it investigates fundamental questions rather than relying only on habit or authority.\n\nQUICK REVISION\nWhat do philo and sophia mean? Why is philosophy described as an activity? What makes a question philosophical?`,
  },
  {
    key: 'features',
    title: 'Lesson 2: Basic Features of Philosophy',
    pages: '16-20',
    content: `SOURCE MATERIAL\nPhilosophy has five connected features. First, it may mean a set of views or beliefs about life and the universe. Second, it is reflection on and criticism of beliefs: philosophers examine whether beliefs are coherent and justified. Third, it is a rational attempt to understand the world as a whole. Fourth, it uses logical analysis of language to clarify concepts and expose ambiguity. Fifth, it is inquiry into enduring fundamental questions that remain important across times and cultures.\n\nCOMPARISON\nA belief is a view someone holds. Philosophical reflection examines that belief. Rational inquiry gives reasons and considers the whole picture. Logical analysis clarifies the words used. Fundamental inquiry asks questions whose importance is not exhausted by one immediate practical problem.\n\nCOMMON MISUNDERSTANDING\nPhilosophy is not simply memorizing philosophers' opinions, arguing for its own sake, or giving an untestable personal preference. It includes knowledge of views, but also critical reflection, reasoning, clarification, and inquiry.\n\nADDITIONAL LEARNING EXAMPLE\nWhen Bonsa asks whether “success” means income, social respect, personal fulfillment, or something else, he is using logical analysis to clarify a concept before evaluating a claim about success.\n\nKEY TAKEAWAYS\nRemember the five features: views, reflection and criticism, rational whole-world understanding, logical language analysis, and enduring fundamental questions.`,
  },
  {
    key: 'metaphysics-epistemology',
    title: 'Lesson 3: Metaphysics and Epistemology',
    pages: '21-26',
    content: `SOURCE MATERIAL\nMetaphysics studies the nature of reality and what exists. Its questions include cosmological questions about the universe, theological questions about God or the divine, anthropological questions about human nature, and ontological questions about being and existence.\n\nEpistemology studies the nature, sources, limits, and justification of knowledge. Empiricism emphasizes experience and observation; rationalism emphasizes reason and thinking. Intuition, revelation, and authority are also discussed as possible sources of knowledge, though each raises questions about reliability and justification. Skepticism challenges whether knowledge or certainty is possible and asks what evidence would justify a belief.\n\nCOMPARISON\nMetaphysics asks “What is real?” Epistemology asks “How do we know?” A person may claim that the world exists independently of the mind (a metaphysical claim), then ask whether observation or reason can justify that claim (an epistemological question).\n\nCOMMON MISUNDERSTANDING\nSkepticism is not automatically the denial of every belief. It is a critical position that tests claims to knowledge and certainty. Likewise, empiricism does not mean that reasoning is useless; it emphasizes the role of experience.\n\nKEY TAKEAWAYS\nIdentify the branch from the question being asked: reality and existence belong to metaphysics; knowledge, evidence, truth, and certainty belong to epistemology.`,
  },
  {
    key: 'axiology-logic',
    title: 'Lesson 4: Axiology and Logic',
    pages: '27-32',
    content: `SOURCE MATERIAL\nAxiology is the study of value. Ethics studies right and wrong conduct. Normative ethics develops principles or standards for evaluating conduct; meta-ethics examines the meaning and status of moral claims; applied ethics considers concrete issues. Aesthetics studies beauty, art, and artistic value. Social and political philosophy examines society, institutions, justice, power, rights, and political organization.\n\nLogic studies correct reasoning and the structure of arguments. An argument gives reasons, called premises, in support of a conclusion. Logic helps determine whether an inference follows correctly from its premises. It does not by itself settle every factual or value question; it helps us reason clearly about them.\n\nADDITIONAL LEARNING EXAMPLE\nBonsa compares two student-union proposals. He identifies each proposal’s premises and conclusion, checks whether the conclusion follows, and then separately considers whether the outcome is fair. The first task is logical analysis; the second involves value and social-political questions.\n\nKEY TAKEAWAYS\nAxiology concerns value, including ethics and aesthetics. Logic concerns arguments and correct reasoning. Ethics, aesthetics, social-political philosophy, and logic address different but related questions.`,
  },
  {
    key: 'importance',
    title: 'Lesson 5: Importance of Learning Philosophy',
    pages: '33-36',
    content: `SOURCE MATERIAL\nLearning philosophy develops independent and critical thinking. It encourages reflective self-awareness: students examine their own assumptions, reasons, values, and goals. It promotes tolerance and open-mindedness by requiring serious consideration of views different from one’s own. It improves clarity of expression, careful reading, rational discussion, and the ability to distinguish reasons from unsupported claims. Philosophy also helps students recognize complexity, avoid premature certainty, and make more responsible judgments.\n\nLEARNING ACTIVITY\nChoose a claim from campus life. State the claim, define its important terms, list its reasons, identify an assumption, consider a contrary view, and explain what evidence would change your mind.\n\nADDITIONAL LEARNING EXAMPLE\nBonsa disagrees with a classmate about whether attendance should be compulsory. Instead of dismissing the classmate, he reconstructs the argument, asks what “learning” means in the claim, and considers evidence about access and outcomes. This demonstrates tolerance, open-mindedness, and independent thinking.\n\nCHAPTER SUMMARY\nPhilosophy is the love of wisdom and an activity of rational inquiry. Its features include beliefs, criticism, whole-world understanding, logical analysis, and enduring questions. Metaphysics studies reality; epistemology studies knowledge; axiology studies value; and logic studies correct reasoning. Philosophy strengthens independent thought, reflection, tolerance, open-mindedness, clarity, and responsible judgment.\n\nSELF-CHECK\nDefine philosophy. Name its five features. Distinguish metaphysics from epistemology. Explain empiricism and rationalism. Name the main areas of axiology. What benefits can philosophy provide?`,
  },
];

const facts = [
  ['Philosophy', 'the love and disciplined pursuit of wisdom', 'Lesson 1', '11-15'],
  ['philo', 'love', 'Lesson 1', '11-15'],
  ['sophia', 'wisdom', 'Lesson 1', '11-15'],
  ['philosophical questioning', 'examining meaning, assumptions, reasons, and consequences', 'Lesson 1', '11-15'],
  ['philosophy as an activity', 'questioning, reflecting, reasoning, clarifying, and revising beliefs', 'Lesson 1', '11-15'],
  ['the first feature of philosophy', 'a set of views or beliefs about life and the universe', 'Lesson 2', '16-20'],
  ['the second feature of philosophy', 'reflection on and criticism of beliefs', 'Lesson 2', '16-20'],
  ['the third feature of philosophy', 'a rational attempt to understand the world as a whole', 'Lesson 2', '16-20'],
  ['the fourth feature of philosophy', 'logical analysis of language and clarification of concepts', 'Lesson 2', '16-20'],
  ['the fifth feature of philosophy', 'inquiry into enduring fundamental questions', 'Lesson 2', '16-20'],
  ['metaphysics', 'the study of reality and what exists', 'Lesson 3', '21-26'],
  ['cosmology', 'the study of the universe', 'Lesson 3', '21-26'],
  ['theology', 'inquiry concerning God or the divine', 'Lesson 3', '21-26'],
  ['anthropology', 'inquiry concerning human nature', 'Lesson 3', '21-26'],
  ['ontology', 'the study of being and existence', 'Lesson 3', '21-26'],
  ['epistemology', 'the study of knowledge, its sources, limits, and justification', 'Lesson 3', '21-26'],
  ['empiricism', 'the view that emphasizes experience and observation', 'Lesson 3', '21-26'],
  ['rationalism', 'the view that emphasizes reason', 'Lesson 3', '21-26'],
  ['skepticism', 'critical questioning of knowledge and certainty', 'Lesson 3', '21-26'],
  ['axiology', 'the study of value', 'Lesson 4', '27-32'],
  ['ethics', 'the study of right and wrong conduct', 'Lesson 4', '27-32'],
  ['normative ethics', 'the development of standards for evaluating conduct', 'Lesson 4', '27-32'],
  ['meta-ethics', 'the study of the meaning and status of moral claims', 'Lesson 4', '27-32'],
  ['applied ethics', 'the consideration of concrete ethical issues', 'Lesson 4', '27-32'],
  ['aesthetics', 'the study of beauty, art, and artistic value', 'Lesson 4', '27-32'],
  ['logic', 'the study of correct reasoning and argument structure', 'Lesson 4', '27-32'],
  ['argument', 'reasons or premises offered in support of a conclusion', 'Lesson 4', '27-32'],
  ['independent thinking', 'forming judgments through one’s own reasoned evaluation', 'Lesson 5', '33-36'],
  ['reflective self-awareness', 'examining one’s own assumptions, reasons, values, and goals', 'Lesson 5', '33-36'],
  ['open-mindedness', 'seriously considering views different from one’s own', 'Lesson 5', '33-36'],
];

function explanation(term: string, definition: string, lesson: string, pages: string) {
  return `${term} means ${definition}. Source material: ${source}, ${lesson}, source pages ${pages}.`;
}

function makeBank(): BankQuestion[] {
  const bank: BankQuestion[] = [];
  for (let i = 0; i < 80; i++) {
    const [term, def, lesson, pages] = facts[i % facts.length];
    const wrong = facts.filter((_, j) => j % facts.length !== i % facts.length).slice(i % 4, i % 4 + 3).map((f) => f[1]);
    bank.push({ id: `mcq-${i + 1}`, type: 'MCQ', points: 1, difficulty: i % 3 === 0 ? 'EASY' : i % 3 === 1 ? 'MEDIUM' : 'HARD', question: `Which statement best describes ${term}?`, options: [{ id: 'a', text: def, explanation: 'This matches the source definition.' }, ...wrong.map((text, n) => ({ id: String.fromCharCode(98 + n), text, explanation: 'This describes a different concept in Chapter One.' }))], correct: ['a'], explanation: explanation(term, def, lesson, pages) });
  }
  for (let i = 0; i < 40; i++) {
    const [term, def, lesson, pages] = facts[(i + 7) % facts.length];
    const truth = i % 2 === 0;
    bank.push({ id: `boolean-${i + 1}`, type: 'BOOLEAN', points: 1, difficulty: i % 2 ? 'MEDIUM' : 'EASY', question: truth ? `${term} is described in Chapter One as ${def}.` : `${term} is described in Chapter One as something unrelated to ${def}.`, correct_boolean: truth, explanation: explanation(term, def, lesson, pages) });
  }
  for (let i = 0; i < 30; i++) {
    const [term, def, lesson, pages] = facts[(i + 11) % facts.length];
    bank.push({ id: `blank-${i + 1}`, type: 'BLANK', points: 1, difficulty: i % 3 === 0 ? 'EASY' : 'MEDIUM', question: `Complete the sentence: ${term} means ________.`, accepted: [[def]], explanation: explanation(term, def, lesson, pages) });
  }
  for (let i = 0; i < 15; i++) {
    const [term, def, lesson, pages] = facts[(i + 3) % facts.length];
    bank.push({ id: `matching-${i + 1}`, type: 'SHORT', points: 2, difficulty: 'MEDIUM', grading_mode: 'MANUAL', question: `Matching exercise: write the letter of the definition that matches “${term}”, then explain the match in one sentence.`, model_answer: `${term}: ${def}.`, explanation: explanation(term, def, lesson, pages) });
  }
  for (let i = 0; i < 25; i++) {
    const [term, def, lesson, pages] = facts[(i + 9) % facts.length];
    bank.push({ id: `short-${i + 1}`, type: 'SHORT', points: 3, difficulty: i % 3 === 0 ? 'MEDIUM' : 'HARD', grading_mode: 'MANUAL', question: `In your own words, explain ${term} and give one reason it matters in philosophical inquiry.`, model_answer: `${term} means ${def}. It matters because philosophy uses reasoned inquiry to clarify concepts and examine claims.`, explanation: explanation(term, def, lesson, pages) });
  }
  for (let i = 0; i < 10; i++) {
    const [term, def, lesson, pages] = facts[(i + 15) % facts.length];
    bank.push({ id: `essay-${i + 1}`, type: 'SHORT', points: 5, difficulty: 'HARD', grading_mode: 'MANUAL', question: `Essay: Compare ${term} with one related concept from Chapter One. Define both, explain their relationship, and use a clear example.`, model_answer: `${term} means ${def}. A strong answer defines the related concept, distinguishes the two ideas, and gives a relevant example grounded in the chapter.`, explanation: explanation(term, def, lesson, pages) });
  }
  return bank;
}

const bank = makeBank();
const by = (prefix: string, count: number) => bank.filter((q) => String(q.id).startsWith(prefix)).slice(0, count);
const withPoints = (q: BankQuestion, points: number): BankQuestion => ({ ...q, points });
const examQuestions = [
  { key: 'exam-a', title: 'Exam A - Basic Knowledge Test', duration_minutes: 30, max_score: 30, questions: [...by('mcq-', 20), ...by('boolean-', 10)] },
  { key: 'exam-b', title: 'Exam B - Standard Chapter Examination', duration_minutes: 60, max_score: 50, questions: [...by('mcq-', 25), ...by('boolean-', 10), ...by('short-', 5)].map((q) => withPoints(q, q.id.startsWith('short-') ? 3 : 1)) },
  { key: 'exam-c', title: 'Exam C - Advanced Examination', duration_minutes: 90, max_score: 70, questions: [...by('mcq-', 20), ...by('matching-', 5), ...by('short-', 5), ...by('essay-', 2)].map((q) => withPoints(q, q.id.startsWith('matching-') ? 2 : q.id.startsWith('essay-') ? 5 : q.id.startsWith('short-') ? 3 : 1)) },
  { key: 'exam-d', title: 'Exam D - Full Chapter Mock Exam', duration_minutes: 120, max_score: 100, questions: [...by('mcq-', 45), ...by('boolean-', 20), ...by('blank-', 10), ...by('short-', 10), ...by('matching-', 5)].map((q) => withPoints(q, q.id.startsWith('short-') ? 2 : 1)) },
];

async function main() {
  const summary = { course: 'skipped', chapter: 'skipped', lessons: { created: 0, skipped: 0 }, assessments: { created: 0, skipped: 0 }, questions: bank.length };
  try {
    await db.$connect();
    await db.$transaction(async (tx) => {
      let course = await tx.course.findFirst({ where: { OR: [{ title: 'Logic and Critical Thinking' }, { title: 'Critical Thinking' }] }, orderBy: { created_at: 'asc' } });
      if (!course) {
        const instructor = await tx.user.findFirst({ where: { role: { in: ['INSTRUCTOR', 'ADMIN', 'SUPER_ADMIN'] }, active: true }, orderBy: { created_at: 'asc' } });
        if (!instructor) throw new Error('No instructor or administrator exists to own PHIL 1011');
        course = await tx.course.create({ data: { id: stableId('course'), instructor_id: instructor.id, title: 'Logic and Critical Thinking', description: 'PHIL 1011 - Logic and Critical Thinking', category: 'Philosophy', price_minor: 0, published: false, visibility: 'PRIVATE' } });
        summary.course = 'created';
      } else summary.course = 'reused';
      let chapter = await tx.chapter.findFirst({ where: { course_id: course.id, title: 'Chapter One - Introducing Philosophy' } });
      if (!chapter) {
        const last = await tx.chapter.findFirst({ where: { course_id: course.id }, orderBy: { position: 'desc' }, select: { position: true } });
        chapter = await tx.chapter.create({ data: { id: stableId('chapter-one'), course_id: course.id, title: 'Chapter One - Introducing Philosophy', position: (last?.position ?? -1) + 1 } });
        summary.chapter = 'created';
      } else summary.chapter = 'reused';
      const existingLessons = await tx.lesson.findMany({ where: { course_id: course.id } });
      const maxPosition = existingLessons.reduce((m, l) => Math.max(m, l.position), -1);
      for (const [index, lesson] of lessons.entries()) {
        const id = stableId(`lesson-${lesson.key}`);
        const existing = await tx.lesson.findUnique({ where: { id } });
        if (existing) { summary.lessons.skipped++; continue; }
        const sameTitle = existingLessons.find((l) => l.title === lesson.title);
        if (sameTitle) { summary.lessons.skipped++; continue; }
        await tx.lesson.create({ data: { id, course_id: course.id, chapter_id: chapter.id, chapter: chapter.title, title: lesson.title, position: maxPosition + index + 1, kind: 'TEXT', preview: index === 0, content: `${lesson.content}\n\nSOURCE PROVENANCE\n${source}; source pages ${lesson.pages}.` } });
        summary.lessons.created++;
      }
      for (const exam of examQuestions) {
        const id = stableId(exam.key);
        const existing = await tx.assessment.findUnique({ where: { id } });
        if (existing) { summary.assessments.skipped++; continue; }
        await tx.assessment.create({ data: { id, course_id: course.id, title: `${exam.title} (AI-generated practice exam)`, kind: 'EXAM', chapter: chapter.title, prompt: `Practice examination based on ${source}. This is not an official university examination. Short-answer and essay responses require manual review using the model answers and rubric.`, question_bank: exam.questions as Prisma.InputJsonValue, questions: exam.questions.map((q) => q.question) as Prisma.InputJsonValue, structured: true, published: true, practice: true, max_score: exam.max_score, duration_minutes: exam.duration_minutes, max_attempts: 3, allow_navigation: true, results_published: true } });
        summary.assessments.created++;
      }
      await tx.auditLog.create({ data: { action: 'COURSE_CONTENT_SEEDED', resource_type: 'COURSE', resource_id: course.id, description: 'Seeded PHIL 1011 Chapter One - Introducing Philosophy', metadata: { source, chapter: chapter.title, question_counts: { MCQ: 80, BOOLEAN: 40, BLANK: 30, MATCHING_MANUAL_SHORT: 15, SHORT: 25, ESSAY_MANUAL_SHORT: 10 }, practice_exams: 4 } as Prisma.InputJsonValue } });
    }, { maxWait: 30_000, timeout: 120_000 });
    console.log(JSON.stringify(summary, null, 2));
  } finally { await db.$disconnect(); }
}

await main();
