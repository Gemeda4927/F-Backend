import type { Prisma } from '../../generated/prisma/client.js';

export type Notice = {
  event_key: string;
  kind: string;
  title: string;
  message: string;
  href: string;
  course_id?: string;
};
export async function notify(
  tx: Prisma.TransactionClient,
  userIds: string[],
  notice: Notice,
) {
  if (!userIds.length) return { count: 0 };
  return tx.notification.createMany({
    data: [...new Set(userIds)].map((user_id) => ({ user_id, ...notice })),
    skipDuplicates: true,
  });
}
export async function notifyCourse(
  tx: Prisma.TransactionClient,
  courseId: string,
  notice: Omit<Notice, 'course_id'>,
) {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { published: true },
  });
  if (!course?.published) return { count: 0 };
  const members = await tx.enrollment.findMany({
    where: {
      course_id: courseId,
      status: 'ACTIVE',
      entitlement: { state: 'ACTIVE' },
      user: { active: true, suspended: false },
      OR: [{ payment_id: null }, { payment: { status: 'SUCCEEDED' } }],
    },
    select: { user_id: true },
  });
  return notify(
    tx,
    members.map((x) => x.user_id),
    { ...notice, course_id: courseId },
  );
}
