import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../../common/types.js';
import type { CourseDto } from './courses.dto.js';
@Injectable()
export class CoursesService {
  constructor(private readonly db: PrismaService) {}
  async catalog(search = '') {
    const contains = search.slice(0, 100);
    const rows = await this.db.course.findMany({
      where: {
        published: true, archived_at: null,
        OR: [
          { title: { contains, mode: 'insensitive' } },
          { category: { contains, mode: 'insensitive' } },
        ],
      },
      include: {
        instructor: { select: { name: true } },
        _count: { select: { lessons: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return rows.map(({ instructor, _count, ...course }) => ({
      ...course,
      instructor_name: instructor.name,
      lesson_count: _count.lessons,
    }));
  }
  async details(id: string) {
    const row = await this.db.course.findFirst({
      where: { id, published: true, archived_at: null },
      include: {
        instructor: { select: { name: true } },
        lessons: {
          select: {
            id: true,
            title: true,
            position: true,
            kind: true,
            preview: true,
          },
          orderBy: { position: 'asc' },
        },
      },
    });
    if (!row) throw new NotFoundException('Course not found');
    const { instructor, ...course } = row;
    return { ...course, instructor_name: instructor.name };
  }
  async learningDetails(user: CurrentUser, id: string) {
    if (!(await this.canAccess(user, id))) throw new ForbiddenException('Course access required');
    const row = await this.db.course.findUniqueOrThrow({ where: { id }, include: { instructor: { select: { name: true } }, lessons: { select: { id: true, title: true, position: true, kind: true, preview: true }, orderBy: { position: 'asc' } } } });
    const { instructor, ...course } = row;
    return { ...course, instructor_name: instructor.name };
  }
  owned(user: CurrentUser) {
    return this.db.course.findMany({
      where: ['ADMIN', 'SUPER_ADMIN'].includes(user.role)
        ? {}
        : { instructor_id: user.id },
      include: { _count: { select: { lessons: true, enrollments: { where: { status: 'ACTIVE', entitlement: { state: 'ACTIVE' } } } } } },
      orderBy: { created_at: 'desc' },
    });
  }
  async assertOwner(user: CurrentUser, id: string) {
    const course = await this.db.course.findUnique({ where: { id } });
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
        id: true, title: true, description: true, category: true,
        price_minor: true, currency: true, published: true,
        lessons: { select: { id: true, title: true, position: true, kind: true, preview: true }, orderBy: { position: 'asc' } },
      },
    });
  }
  async archive(user: CurrentUser, id: string, archived: boolean) {
    await this.assertOwner(user, id);
    return this.db.course.update({ where: { id }, data: { archived_at: archived ? new Date() : null }, select: { id: true, archived_at: true } });
  }
  create(user: CurrentUser, dto: CourseDto) {
    return this.db.course.create({ data: { title:dto.title,description:dto.description,category:dto.category,price_minor:dto.price_minor,currency:dto.currency,published:dto.published, instructor_id: user.id } });
  }
  async update(user: CurrentUser, id: string, dto: CourseDto) {
    await this.assertOwner(user, id);
    return this.db.course.update({ where: { id }, data: dto });
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
