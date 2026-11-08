import { audit } from '../audit/audit.js';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../../common/types.js';
import type { CourseDto } from './courses.dto.js';
import { notifyCourse } from '../notifications/notifications.js';
@Injectable()
export class CoursesService {
  constructor(private readonly db: PrismaService) {}
  indexable() {
    return this.db.course.findMany({
      where: { published: true, archived_at: null, visibility: 'PUBLIC' },
      select: { id: true, updated_at: true },
      orderBy: { id: 'asc' },
    });
  }
  async catalog(search = '') {
    const contains = search.slice(0, 100);
    const rows = await this.db.course.findMany({
      where: {
        published: true,
        archived_at: null,
        visibility: 'PUBLIC',
        OR: [
          { title: { contains, mode: 'insensitive' } },
          { category: { contains, mode: 'insensitive' } },
        ],
      },
      include: {
        instructor: { select: { name: true } },
        lessons: { select: { chapter: true, kind: true, preview: true } },
        _count: {
          select: {
            lessons: true,
            assessments: { where: { published: true } },
            enrollments: {
              where: { status: 'ACTIVE', entitlement: { state: 'ACTIVE' } },
            },
          },
        },
        thumbnail: { select: { course_id: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return rows.map(
      ({ instructor, _count, thumbnail, lessons, ...course }) => ({
        ...course,
        instructor_name: instructor.name,
        lesson_count: _count.lessons,
        chapter_count: new Set(
          lessons.map((lesson) => lesson.chapter?.trim() || 'Getting started'),
        ).size,
        assessment_count: _count.assessments,
        enrollment_count: _count.enrollments,
        preview_count: lessons.filter((lesson) => lesson.preview).length,
        quiz_count: lessons.filter((lesson) => lesson.kind === 'QUIZ').length,
        has_thumbnail: !!thumbnail,
      }),
    );
  }
  async details(id: string) {
    const row = await this.db.course.findFirst({
      where: { id, published: true, archived_at: null, visibility: 'PUBLIC' },
      include: {
        instructor: { select: { name: true } },
        thumbnail: { select: { course_id: true } },
        lessons: {
          select: {
            id: true,
            title: true,
            chapter: true,
            position: true,
            kind: true,
            practice: true,
            preview: true,
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Course not found');
    const { instructor, thumbnail, ...course } = row;
    return {
      ...course,
      instructor_name: instructor.name,
      has_thumbnail: !!thumbnail,
    };
  }
  async learningDetails(user: CurrentUser, id: string) {
    if (!(await this.canAccess(user, id)))
      throw new ForbiddenException('Course access required');
    const row = await this.db.course.findUniqueOrThrow({
      where: { id },
      include: {
        instructor: { select: { name: true } },
        lessons: {
          select: {
            id: true,
            title: true,
            chapter: true,
            position: true,
            kind: true,
            practice: true,
            preview: true,
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    const { instructor, ...course } = row;
    return { ...course, instructor_name: instructor.name };
  }
  async owned(user: CurrentUser) {
    const rows = await this.db.course.findMany({
      where: ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
        ? {}
        : { instructor_id: user.id },
      include: {
        instructor: { select: { name: true } },
        _count: {
          select: {
            lessons: true,
            enrollments: {
              where: { status: 'ACTIVE', entitlement: { state: 'ACTIVE' } },
            },
          },
        },
        thumbnail: { select: { course_id: true } },
      },
      orderBy: { created_at: 'desc' },
    });
    return rows.map(({ thumbnail, instructor, ...course }) => ({
      ...course,
      has_thumbnail: !!thumbnail,
      instructor_name: instructor.name,
    }));
  }
  async transfer(
    user: CurrentUser,
    id: string,
    ownerId: string,
    reason: string,
  ) {
    if (user.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('Only Super Admin can transfer ownership');
    return this.db.atomic(async (tx) => {
      const course = await tx.course.findUniqueOrThrow({ where: { id } });
      const instructor = await tx.user.findFirst({
        where: {
          id: ownerId,
          role: 'INSTRUCTOR',
          active: true,
          suspended: false,
        },
      });
      if (!instructor)
        throw new ForbiddenException('Select an active instructor');
      await tx.course.update({
        where: { id },
        data: { instructor_id: ownerId },
      });
      await audit(tx, {
        actor: user,
        target: ownerId,
        action: 'COURSE_OWNER_TRANSFERRED',
        description: 'Course ownership transferred.',
        reason,
        resourceType: 'COURSE',
        resourceId: id,
        oldValues: { instructor_id: course.instructor_id },
        newValues: { instructor_id: ownerId },
      });
      return { transferred: true };
    });
  }
  async managedDetails(user: CurrentUser, id: string) {
    await this.assertOwner(user, id);
    const row = await this.db.course.findUniqueOrThrow({
      where: { id },
      include: {
        instructor: { select: { name: true } },
        thumbnail: { select: { course_id: true } },
        _count: {
          select: {
            lessons: true,
            assessments: true,
            enrollments: {
              where: { status: 'ACTIVE', entitlement: { state: 'ACTIVE' } },
            },
          },
        },
      },
    });
    const { thumbnail, instructor, ...course } = row;
    return {
      ...course,
      has_thumbnail: !!thumbnail,
      instructor_name: instructor.name,
    };
  }
  async publicThumbnail(id: string) {
    const image = await this.db.courseThumbnail.findFirst({
      where: {
        course_id: id,
        course: { visibility: 'PUBLIC', published: true, archived_at: null },
      },
      select: { content: true, mime_type: true },
    });
    if (!image) throw new NotFoundException('Thumbnail not found');
    return image;
  }
  async authorizedThumbnail(user: CurrentUser, id: string) {
    if (!(await this.canAccess(user, id)))
      throw new NotFoundException('Thumbnail not found');
    const image = await this.db.courseThumbnail.findUnique({
      where: { course_id: id },
      select: { content: true, mime_type: true },
    });
    if (!image) throw new NotFoundException('Thumbnail not found');
    return image;
  }
  async saveThumbnail(
    user: CurrentUser,
    id: string,
    content: Buffer,
    mime: string,
  ) {
    await this.assertOwner(user, id);
    const bytes = Uint8Array.from(content);
    await this.db.courseThumbnail.upsert({
      where: { course_id: id },
      create: { course_id: id, content: bytes, mime_type: mime },
      update: { content: bytes, mime_type: mime },
    });
    return { message: 'Thumbnail saved' };
  }
  async removeThumbnail(user: CurrentUser, id: string) {
    await this.assertOwner(user, id);
    await this.db.courseThumbnail.deleteMany({ where: { course_id: id } });
    return { message: 'Thumbnail removed' };
  }
  async assertOwner(
    user: CurrentUser,
    id: string,
    client?: Prisma.TransactionClient,
  ) {
    const course = await (client ?? this.db).course.findUnique({
      where: { id },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (
      !['ADMIN', 'SUPER_ADMIN'].includes(user.role) &&
      !(user.role === 'INSTRUCTOR' && course.instructor_id === user.id)
    )
      throw new ForbiddenException('You may manage only your own courses');
    return course;
  }
  async preview(user: CurrentUser, id: string) {
    await this.assertOwner(user, id);
    return this.db.course.findUniqueOrThrow({
      where: { id },
      select: {
        id: true,
        title: true,
        description: true,
        category: true,
        price_minor: true,
        currency: true,
        published: true,
        visibility: true,
        lessons: {
          select: {
            id: true,
            title: true,
            chapter: true,
            position: true,
            kind: true,
            practice: true,
            preview: true,
          },
          orderBy: { position: 'asc' },
        },
      },
    });
  }
  async archive(user: CurrentUser, id: string, archived: boolean) {
    await this.assertOwner(user, id);
    return this.db.course.update({
      where: { id },
      data: { archived_at: archived ? new Date() : null },
      select: { id: true, archived_at: true },
    });
  }
  create(user: CurrentUser, dto: CourseDto) {
    return this.db.course.create({
      data: {
        title: dto.title,
        description: dto.description,
        category: dto.category,
        price_minor: dto.price_minor,
        currency: dto.currency,
        published: dto.published,
        visibility: dto.visibility ?? 'PRIVATE',
        instructor_id: user.id,
      },
    });
  }
  async update(user: CurrentUser, id: string, dto: CourseDto) {
    await this.assertOwner(user, id);
    return this.db.atomic(async (tx) => {
      const previous = await this.assertOwner(user, id, tx);
      const updated = await tx.course.update({ where: { id }, data: dto });
      if (previous.published !== updated.published)
        await audit(tx, {
          actor: user,
          target: previous.instructor_id,
          action: updated.published ? 'COURSE_PUBLISHED' : 'COURSE_UNPUBLISHED',
          description: `Course ${updated.published ? 'published' : 'unpublished'}: ${updated.title}`,
          resourceType: 'COURSE',
          resourceId: id,
        });
      await notifyCourse(tx, id, {
        event_key: `course:${id}:${updated.updated_at.toISOString()}`,
        kind: 'COURSE',
        title: `Course updated: ${updated.title}`,
        message: 'Your instructor updated the course information.',
        href: `/learn/${id}?tab=overview`,
      });
      return updated;
    });
  }
  async canAccess(
    user: CurrentUser,
    courseId: string,
    client?: Prisma.TransactionClient,
  ) {
    const db = client ?? this.db,
      course = await db.course.findUnique({ where: { id: courseId } });
    if (!course) return false;
    if (
      ['ADMIN', 'SUPER_ADMIN'].includes(user.role) ||
      (user.role === 'INSTRUCTOR' && course.instructor_id === user.id)
    )
      return true;
    if (!course.published) return false;
    const enrollment = await db.enrollment.findUnique({
      where: { user_id_course_id: { user_id: user.id, course_id: courseId } },
      include: { payment: true, entitlement: true },
    });
    return (
      !!enrollment &&
      enrollment.status === 'ACTIVE' &&
      enrollment.entitlement?.state === 'ACTIVE' &&
      (!enrollment.payment_id ||
        (enrollment.payment?.status === 'SUCCEEDED' &&
          enrollment.payment.user_id === user.id &&
          enrollment.payment.course_id === courseId))
    );
  }
}
