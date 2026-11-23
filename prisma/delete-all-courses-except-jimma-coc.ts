import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';

if (process.env.NODE_ENV !== 'production') loadEnvFile('.env');

const PROTECTED_ID = '0d1aaac8-f120-47c1-af53-4c66f02e9240';
const PROTECTED_TITLE = 'JIMMA COC FOR HEALTH STUDENTS';
const CONFIRM_ENV = 'CONFIRM_DELETE_ALL_NON_JIMMA_COURSES';

if (!process.env.DATABASE_URL && !process.env.DIRECT_URL) {
  throw new Error('DATABASE_URL or DIRECT_URL is required');
}

const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL!,
    connectionTimeoutMillis: 30_000,
  }),
});

async function main() {
  const courses = await db.course.findMany({
    select: { id: true, title: true },
    orderBy: [{ title: 'asc' }, { id: 'asc' }],
  });

  const protectedCourses = courses.filter(
    (course) => course.id === PROTECTED_ID || course.title === PROTECTED_TITLE,
  );

  if (
    protectedCourses.length !== 1 ||
    protectedCourses[0].id !== PROTECTED_ID ||
    protectedCourses[0].title !== PROTECTED_TITLE
  ) {
    throw new Error(
      `Refusing to continue: expected exactly one protected course with id ${PROTECTED_ID} and title ${PROTECTED_TITLE}. Found: ${JSON.stringify(protectedCourses)}`,
    );
  }

  const targets = courses.filter((course) => course.id !== PROTECTED_ID);
  console.log(`Protected course: ${PROTECTED_TITLE} (${PROTECTED_ID})`);
  console.log(`Courses to delete: ${targets.length}`);
  for (const course of targets) console.log(`- ${course.title} (${course.id})`);

  if (process.env[CONFIRM_ENV] !== 'YES') {
    console.log(`Preview only. Set ${CONFIRM_ENV}=YES to perform deletion.`);
    return;
  }

  const deleted = await db.$transaction(async (tx) => {
    let counts = {
      courses: 0,
      assessments: 0,
      lessons: 0,
      chapters: 0,
      enrollments: 0,
      payments: 0,
      contributions: 0,
    };

    for (const course of targets) {
      const assessments = await tx.assessment.findMany({
        where: { course_id: course.id },
        select: { id: true },
      });
      const assessmentIds = assessments.map(({ id }) => id);
      if (assessmentIds.length > 0) {
        await tx.assessmentSubmission.deleteMany({ where: { assessment_id: { in: assessmentIds } } });
        await tx.assessmentFile.deleteMany({ where: { assessment_id: { in: assessmentIds } } });
        await tx.assessmentAttempt.deleteMany({ where: { assessment_id: { in: assessmentIds } } });
        await tx.assessmentImage.deleteMany({ where: { assessment_id: { in: assessmentIds } } });
        await tx.assessment.deleteMany({ where: { id: { in: assessmentIds } } });
        counts.assessments += assessmentIds.length;
      }

      const lessons = await tx.lesson.findMany({
        where: { course_id: course.id },
        select: { id: true },
      });
      const lessonIds = lessons.map(({ id }) => id);
      if (lessonIds.length > 0) {
        await tx.learningProgress.deleteMany({ where: { lesson_id: { in: lessonIds } } });
        await tx.lesson.deleteMany({ where: { id: { in: lessonIds } } });
        counts.lessons += lessonIds.length;
      }

      const chapters = await tx.chapter.findMany({
        where: { course_id: course.id },
        select: { id: true },
      });
      if (chapters.length > 0) {
        await tx.chapter.deleteMany({ where: { id: { in: chapters.map(({ id }) => id) } } });
        counts.chapters += chapters.length;
      }

      const contributions = await tx.contribution.findMany({
        where: { course_id: course.id },
        select: { id: true },
      });
      const contributionIds = contributions.map(({ id }) => id);
      if (contributionIds.length > 0) {
        await tx.contributionVote.deleteMany({ where: { contribution_id: { in: contributionIds } } });
        await tx.contributionCreditEvent.deleteMany({ where: { contribution_id: { in: contributionIds } } });
        await tx.contribution.deleteMany({ where: { id: { in: contributionIds } } });
        counts.contributions += contributionIds.length;
      }

      const enrollments = await tx.enrollment.findMany({
        where: { course_id: course.id },
        select: { id: true, payment_id: true },
      });
      const enrollmentIds = enrollments.map(({ id }) => id);
      const coursePayments = await tx.payment.findMany({
        where: { course_id: course.id },
        select: { id: true },
      });
      const paymentIds = Array.from(
        new Set([
          ...enrollments.flatMap(({ payment_id }) => (payment_id ? [payment_id] : [])),
          ...coursePayments.map(({ id }) => id),
        ]),
      );
      if (enrollmentIds.length > 0) {
        await tx.enrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
        counts.enrollments += enrollmentIds.length;
      }
      if (paymentIds.length > 0) {
        await tx.refund.deleteMany({ where: { payment_id: { in: paymentIds } } });
        await tx.payment.deleteMany({ where: { id: { in: paymentIds } } });
        counts.payments += paymentIds.length;
      }

      await tx.notification.deleteMany({ where: { course_id: course.id } });
      await tx.courseView.deleteMany({ where: { course_id: course.id } });
      await tx.courseThumbnail.deleteMany({ where: { course_id: course.id } });
      await tx.course.delete({ where: { id: course.id } });
      counts.courses += 1;
    }

    return counts;
  }, { maxWait: 30_000, timeout: 120_000 });

  const remaining = await db.course.findMany({
    select: { id: true, title: true },
    orderBy: { title: 'asc' },
  });
  if (remaining.length !== 1 || remaining[0].id !== PROTECTED_ID || remaining[0].title !== PROTECTED_TITLE) {
    throw new Error(`Post-delete verification failed: ${JSON.stringify(remaining)}`);
  }
  console.log(`Deletion complete: ${JSON.stringify(deleted)}`);
  console.log(`Verified remaining course: ${remaining[0].title} (${remaining[0].id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
