import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { createHash } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../src/generated/prisma/client.js';

if (existsSync('.env')) loadEnvFile('.env');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 30000,
  }),
});
function id(key: string) {
  const hex = createHash('sha256')
    .update(`learnova:critical-thinking:${key}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const lessons = [
  {
    title: 'Introduction to critical thinking',
    preview: true,
    content: `WELCOME AND LEARNING GOALS\nCritical thinking means examining claims, questioning assumptions, and evaluating evidence before deciding what to believe or do. It is a skill you can practice, not a requirement to disagree with everyone.\n\nBy the end of this course you will be able to identify a claim and its supporting reasons, assess source credibility, recognize common reasoning errors, compare explanations, and justify a decision while acknowledging uncertainty. No prior knowledge is required. Plan for about three hours of reading and practice, plus the assessments.\n\nA SIMPLE ROUTINE\n1. State the question clearly.\n2. Separate facts, interpretations, and opinions.\n3. Identify evidence and missing information.\n4. Consider another explanation.\n5. Reach a proportionate conclusion and explain what could change your mind.\n\nEXAMPLE\nA friend says, "This study app guarantees better grades because everyone in my class uses it." Popularity does not establish effectiveness. Ask how grades were measured, whether students also changed their study habits, and whether comparable students who did not use the app improved too.\n\nPRACTICE\nWrite down a decision you recently made. Identify one fact, one assumption, and one piece of information you wish you had. Keep this note for the final decision exercise.`,
  },
  {
    title: 'Claims, reasons, and hidden assumptions',
    preview: true,
    content: `WHAT IS AN ARGUMENT?\nAn argument connects reasons (premises) to a conclusion. A claim is a statement that can be examined; a reason explains why someone thinks it is true. An assumption is an unstated idea needed for the reasoning to work.\n\nWORKED EXAMPLE\n"The library should stay open later because students need a quiet place after evening classes."\nConclusion: extend library opening hours.\nReason: some students need a quiet evening study space.\nAssumptions: enough students would use it; staffing is feasible; the library is the best available option.\n\nTESTING THE LINK\nAsk two separate questions: Are the reasons credible? If they are true, do they support this conclusion? A true premise may still be irrelevant. One late-night visit cannot show how all students use the library.\n\nPRACTICE\nAnalyze: "We should replace every textbook with videos because my friend learns faster from videos." Identify the conclusion, the reason, and two assumptions. Propose a narrower conclusion that the evidence could support.\n\nSELF-CHECK\nA reasonable narrower conclusion is that video materials may help some learners and deserve a small trial. The statement assumes one learner represents everyone and that videos can replace every function of a textbook.`,
  },
  {
    title: 'Evaluating evidence and source credibility',
    content: `EVIDENCE IS MORE THAN CONFIDENCE\nEvaluate who produced a claim, how the evidence was gathered, whether the source has relevant expertise, and whether independent information supports it. A professional-looking page is not itself evidence.\n\nSOURCE CHECKLIST\nAuthority: Is the author qualified for this specific topic?\nMethod: Is the sample described? Are measurements and comparisons appropriate?\nRelevance: Does the evidence concern the people and decision you are studying?\nCurrency: Is the information recent enough for the question?\nIncentives: Could payment, selection, or sponsorship affect what is reported?\nCorroboration: Can you trace the claim to an original source and compare independent accounts?\n\nEXAMPLE\nAn advertisement reports that "90% of students recommend our tutoring." Before accepting a claim about learning, ask how many students answered, who was invited, what question was asked, and whether improvement was actually measured. Recommendation and improved performance are different outcomes.\n\nPRACTICE\nCompare an anonymous social post, a sales page, and a report that explains its methods. For each, write one useful feature and one limitation. A report can still have weaknesses; credibility is a judgment about evidence, not a label attached to a format.\n\nTAKEAWAY\nMatch confidence to evidence quality and state what remains unknown.`,
  },
  {
    title: 'Checkpoint quiz: arguments and evidence',
    kind: 'QUIZ',
    content:
      'Choose the best answer for each question. Review the first three lessons before submitting. Each question has one correct answer.',
    quiz: [
      {
        question: 'Which statement is a conclusion?',
        options: [
          'A survey included 200 students.',
          'Therefore, the library should trial longer opening hours.',
          'The survey response rate was 40%.',
          'Some students have evening classes.',
        ],
        correctIndex: 1,
      },
      {
        question:
          'An app claims to improve grades based only on customer recommendations. What is the strongest next question?',
        options: [
          'Is the logo attractive?',
          'How many followers does the app have?',
          'Were learning outcomes measured against a suitable comparison?',
          'Do my friends like the app?',
        ],
        correctIndex: 2,
      },
      {
        question: 'What is a hidden assumption?',
        options: [
          'An unstated idea needed for the reasoning to work.',
          'Any statement containing numbers.',
          'The final sentence of every argument.',
          'A fact that no one can question.',
        ],
        correctIndex: 0,
      },
      {
        question: 'Which response best reflects critical thinking?',
        options: [
          'Reject all expert advice.',
          'Accept the most confident speaker.',
          'Treat all sources as equally reliable.',
          'Check methods and adjust confidence to evidence quality.',
        ],
        correctIndex: 3,
      },
    ],
  },
  {
    title: 'Biases and common reasoning mistakes',
    content: `THINKING SHORTCUTS\nShortcuts can help us decide quickly, but they can also distort judgment. Confirmation bias is the tendency to favor information that supports an existing belief. Availability can make a vivid recent example seem more representative than it is.\n\nCOMMON REASONING ERRORS\nPersonal attack: dismissing a proposal because of who presents it rather than examining its merits.\nFalse dilemma: presenting only two choices when other realistic options exist.\nHasty generalization: drawing a broad conclusion from too little or unrepresentative evidence.\nStraw man: replacing another person's argument with a weaker version that is easier to criticize.\n\nEXAMPLE\n"Either we ban phones everywhere or nobody will learn." This ignores intermediate options such as phone-free activities, accessibility exceptions, or agreed classroom rules.\n\nA BETTER HABIT\nBefore criticizing an argument, summarize it in a way its supporter would recognize. Then ask what evidence would count against your own preferred view. Finding a fallacy label is not a substitute for explaining the actual weakness.\n\nPRACTICE\nRewrite: "My cousin failed an online class, so online learning never works." Specify the limited evidence, list two alternative explanations, and make the conclusion appropriately cautious.`,
  },
  {
    title: 'Correlation, causes, and alternative explanations',
    content: `MOVING TOGETHER DOES NOT PROVE CAUSATION\nWhen two things change together, one may influence the other, both may share another cause, or the pattern may be a coincidence. A causal claim needs more than a correlation.\n\nWORKED EXAMPLE\nStudents who attend study groups have higher average scores. Perhaps study groups help; perhaps more motivated students both join groups and study longer. Prior knowledge or access to resources may also matter.\n\nQUESTIONS TO ASK\nDid the proposed cause happen before the outcome?\nWere similar groups compared?\nCould another factor explain the pattern?\nWere groups assigned randomly, or did participants choose?\nIs there a plausible mechanism?\nHave other studies or observations found similar results?\n\nNUMBERS IN CONTEXT\nIn a hypothetical pilot, 6 of 10 students improve. That is 60%, but the small sample creates uncertainty and does not show what would have happened without the pilot. Always ask for counts as well as percentages.\n\nPRACTICE\nDesign a small evaluation of a study group. Describe the outcome you would measure, a fair comparison, and two limitations. Avoid promising that a single small trial will establish a universal result.`,
  },
  {
    title: 'Making and explaining a reasoned decision',
    content: `A PRACTICAL DECISION FRAMEWORK\n1. Define the decision, the people affected, and any constraints.\n2. List realistic options, including a small trial or keeping the current approach.\n3. Choose criteria before comparing options: cost, access, effectiveness, feasibility, and risk may matter.\n4. Separate available evidence from assumptions.\n5. Compare benefits and trade-offs.\n6. Choose an action and explain your confidence.\n7. Decide when to review the outcome.\n\nCASE STUDY\nA student club has a limited budget and must choose between printed revision guides, weekly peer-led study sessions, or a small combination. Students have different schedules and some have limited internet access.\n\nWORKED APPROACH\nAsk members what they need, estimate costs and volunteer time, and check access constraints. A short pilot of peer sessions with a printable summary may be reasonable if volunteers are available. Track attendance and usefulness, but do not mistake satisfaction alone for improved learning.\n\nPRACTICE\nWrite a 150-word recommendation. Name your choice, give two supporting reasons, acknowledge the strongest objection, and explain what new evidence would change your recommendation.\n\nBEFORE YOU FINISH\nReturn to your decision from lesson one. Has your confidence changed? Identify one assumption you can test this week. Complete the assignment and final written exam in the assessments section.`,
  },
  {
    title: 'Final knowledge check',
    kind: 'QUIZ',
    content:
      'Apply the complete critical-thinking routine. These questions check understanding; the written assessments ask you to explain your reasoning.',
    quiz: [
      {
        question:
          'Students who join study groups score higher. What can you conclude from this alone?',
        options: [
          'Study groups always cause higher scores.',
          'There is an association; alternative explanations still need checking.',
          'Motivation cannot matter.',
          'Every student should be required to join.',
        ],
        correctIndex: 1,
      },
      {
        question: 'Which is an example of a false dilemma?',
        options: [
          'We can compare three feasible options.',
          'The estimate has uncertainty.',
          'Either ban every phone or accept that nobody learns.',
          'A pilot could inform the decision.',
        ],
        correctIndex: 2,
      },
      {
        question: 'How can you reduce confirmation bias?',
        options: [
          'Search only for evidence supporting your view.',
          'Ignore conflicting evidence.',
          'Repeat the claim more confidently.',
          'Actively look for credible evidence against your preferred explanation.',
        ],
        correctIndex: 3,
      },
      {
        question: 'What belongs in a strong recommendation?',
        options: [
          'Reasons, trade-offs, uncertainty, and a plan to review outcomes.',
          'Only a confident conclusion.',
          'A personal attack on opponents.',
          'A promise that no further evidence is needed.',
        ],
        correctIndex: 0,
      },
      {
        question:
          'A pilot reports that 60% improved. Which detail is essential context?',
        options: [
          'The presentation font.',
          'The sample size and a suitable comparison.',
          "The spokesperson's popularity.",
          'Whether the result matches your preference.',
        ],
        correctIndex: 1,
      },
    ],
  },
];
const assessments = [
  {
    key: 'assignment',
    title: 'Assignment: analyze an everyday claim',
    kind: 'ASSIGNMENT',
    max_score: 100,
    prompt:
      'Choose a non-sensitive claim from an advertisement, campus discussion, or everyday decision. Write 400–600 words in your own words. Quote or paraphrase the claim and identify its source so a reviewer can locate it. Do not include private information. Rubric: argument structure 25 points; evidence evaluation 30; alternative explanations 20; proportionate conclusion and clarity 25.',
    questions: [
      'What is the claim, its conclusion, and its supporting reasons?',
      'Which assumptions does it depend on, and how credible is the evidence?',
      'What alternative explanation or counterargument deserves consideration?',
      'What is your conclusion, how confident are you, and what would change your mind?',
    ],
  },
  {
    key: 'exam',
    title: 'Final exam: recommend a study-support plan',
    kind: 'EXAM',
    max_score: 100,
    prompt:
      'Hypothetical case: a student club can spend 3,000 ETB on printed revision guides, peer-led study sessions, or a combination. A voluntary survey of 20 members finds 14 prefer videos; the club has 100 members and some have limited internet access. A volunteer says study sessions guarantee better scores because their friends improved. Answer all questions using only this scenario; clearly label any assumptions. Rubric: claims and assumptions 25 points; evidence and causal reasoning 30; feasible alternatives and access 20; justified recommendation and evaluation plan 25.',
    questions: [
      'Identify two claims and two assumptions in the scenario.',
      "Explain two limitations of the survey and why the volunteer's experience does not prove causation.",
      'Compare at least two realistic options, including costs, access, and uncertainty.',
      'Recommend an option and describe a fair way to evaluate a short pilot.',
    ],
  },
];
try {
  const matches = await db.course.findMany({
    where: { title: 'Critical Thinking' },
    select: { id: true },
  });
  if (matches.length !== 1)
    throw new Error('Expected exactly one existing Critical Thinking course');
  const courseId = matches[0].id;
  await db.$transaction(
    async (tx) => {
      const existing = await tx.lesson.findMany({
        where: { course_id: courseId },
        orderBy: { position: 'asc' },
      });
      for (const [position, lesson] of lessons.entries()) {
        const current = existing.find((row) => row.position === position);
        if (
          current &&
          current.id !== id(`lesson:${position}`) &&
          !(
            position === 0 &&
            current.title === lesson.title &&
            (current.content.startsWith(
              'Critical thinking is the practice of',
            ) ||
              current.content === lesson.content)
          )
        )
          throw new Error(
            `Lesson position ${position} contains non-seed content; refusing to overwrite`,
          );
        if (
          current &&
          (await tx.learningProgress.count({
            where: { lesson_id: current.id },
          }))
        )
          throw new Error('Refusing to change a lesson with learner progress');
        const data = {
          title: lesson.title,
          position,
          kind: lesson.kind ?? 'TEXT',
          preview: lesson.preview ?? false,
          content: lesson.content,
          ...(lesson.quiz ? { quiz: lesson.quiz } : {}),
        };
        await tx.lesson.upsert({
          where: { course_id_position: { course_id: courseId, position } },
          create: {
            id: id(`lesson:${position}`),
            course_id: courseId,
            ...data,
          },
          update: data,
        });
      }
      for (const { key, ...data } of assessments) {
        const assessmentId = id(key);
        if (
          await tx.assessmentSubmission.count({
            where: { assessment_id: assessmentId },
          })
        )
          continue;
        await tx.assessment.upsert({
          where: { id: assessmentId },
          create: { id: assessmentId, course_id: courseId, ...data },
          update: data,
        });
      }
      await tx.course.update({
        where: { id: courseId },
        data: {
          description:
            'Build practical reasoning skills for study and everyday decisions. Learn to map arguments, question assumptions, evaluate evidence, recognize bias, distinguish correlation from causation, and explain a balanced recommendation. Includes six reading lessons with worked examples and practice activities, two auto-graded quizzes, a written assignment, and a final case-study exam. Beginner friendly; no prerequisites. Approximately three hours of self-paced study plus assessments. The first two lessons are available as free previews.',
          category: 'Personal development',
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
          resource_id: courseId,
          description:
            'Expanded Critical Thinking sample curriculum and enabled free public discovery.',
          metadata: {
            lessons: lessons.length,
            assessments: assessments.length,
            source: 'seed-critical-thinking',
          } as Prisma.InputJsonValue,
        },
      });
    },
    { maxWait: 30000, timeout: 120000 },
  );
  console.log(
    JSON.stringify({
      courseId,
      lessons: lessons.length,
      quizzes: 2,
      assessments: assessments.length,
      publicUrl: `https://f-fronted-ok2h.vercel.app/courses/${courseId}`,
    }),
  );
} finally {
  await db.$disconnect();
}
