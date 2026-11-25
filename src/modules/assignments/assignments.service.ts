import { ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';
import { cloudinaryConfigured, deleteCloudinaryImage, fetchCloudinaryImage, uploadCloudinaryFile } from '../../common/cloudinary.js';
import { CoursesService } from '../courses/courses.service.js';
import type { AssignmentDto, AssignmentUpdateDto } from './assignments.dto.js';

@Injectable()
export class AssignmentsService {
  constructor(private readonly db: PrismaService, private readonly courses: CoursesService) {}
  private async manager(user: CurrentUser, courseId: string) {
    const course = await this.db.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    if (!['ADMIN', 'SUPER_ADMIN'].includes(user.role) && !(user.role === 'INSTRUCTOR' && course.instructor_id === user.id)) throw new ForbiddenException('You may manage only your own course assignments');
    return course;
  }
  private validatePdf(file?: Express.Multer.File) {
    if (!file?.buffer?.length) throw new ConflictException('Choose a PDF assignment document');
    if (file.size > 20 * 1024 * 1024) throw new ConflictException('Assignment PDF must be 20 MB or smaller');
    if (file.mimetype !== 'application/pdf' || file.buffer.subarray(0, 5).toString() !== '%PDF-') throw new ConflictException('Upload a valid PDF document');
  }
  private safe(row: any) { const { document_url: _document_url, document_public_id: _document_public_id, document_resource_type: _document_resource_type, document_version: _document_version, course, ...safe } = row; return course ? { ...safe, course } : safe; }
  private async recordView(user: CurrentUser, id: string, page?: number) {
    if (user.role !== 'STUDENT') return;
    await this.db.assignmentView.upsert({
      where: { assignment_id_student_id: { assignment_id: id, student_id: user.id } },
      create: { assignment_id: id, student_id: user.id, view_count: 1, ...(page ? { last_page: page } : {}) },
      update: { view_count: { increment: 1 }, last_viewed: new Date(), ...(page ? { last_page: page } : {}) },
    });
  }
  private escapeXml(value: string) { return value.replace(/[<>&'"]/g, (character) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[character] ?? character); }
  private async watermark(image: Buffer, user: CurrentUser) {
    const maskedAccount = user.email.replace(/^(.{2}).*(@.*)$/, '$1••••$2');
    const label = this.escapeXml(`${user.name} • ${maskedAccount} • ${new Date().toISOString()}`);
    const overlay = Buffer.from(`<svg width="1600" height="150"><rect x="24" y="24" width="1552" height="102" rx="18" fill="#111827" fill-opacity="0.72"/><text x="52" y="88" fill="white" font-family="Arial" font-size="28">${label}</text></svg>`);
    return sharp(image).composite([{ input: overlay, gravity: 'south' }]).jpeg({ quality: 88 }).toBuffer();
  }
  async manageCourse(user: CurrentUser, courseId: string) { await this.manager(user, courseId); const rows = await this.db.assignment.findMany({ where: { course_id: courseId }, include: { author: { select: { name: true } } }, orderBy: { created_at: 'desc' } }); return rows.map((row) => ({ ...this.safe(row), created_by_name: row.author.name })); }
  async create(user: CurrentUser, dto: AssignmentDto, file?: Express.Multer.File) {
    await this.manager(user, dto.course_id); this.validatePdf(file); if (!cloudinaryConfigured()) throw new ServiceUnavailableException('Cloudinary storage is not configured');
    const asset = await uploadCloudinaryFile(file!.buffer, 'application/pdf', `learnova/assignments/${randomUUID()}`, 'authenticated', 'raw');
    try { return this.db.assignment.create({ data: { course_id: dto.course_id, created_by: user.id, title: dto.title.trim(), university: dto.university?.trim(), department: dto.department?.trim(), program: dto.program?.trim(), chapter: dto.chapter?.trim() ?? '', description: dto.description?.trim() ?? '', assignment_type: dto.assignment_type, access_type: dto.access_type, total_pages: dto.total_pages, document_public_id: asset.public_id, document_url: asset.secure_url, document_resource_type: asset.resource_type, document_version: asset.version, document_bytes: asset.bytes, document_mime_type: 'application/pdf' } }); } catch (error) { await deleteCloudinaryImage(asset.public_id, 'authenticated', 'raw').catch(() => undefined); throw error; }
  }
  async update(user: CurrentUser, id: string, dto: AssignmentUpdateDto) { const row = await this.db.assignment.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Assignment not found'); await this.manager(user, row.course_id); return this.db.assignment.update({ where: { id }, data: { ...(dto.title !== undefined ? { title: dto.title.trim() } : {}), ...(dto.university !== undefined ? { university: dto.university } : {}), ...(dto.department !== undefined ? { department: dto.department } : {}), ...(dto.program !== undefined ? { program: dto.program } : {}), ...(dto.chapter !== undefined ? { chapter: dto.chapter } : {}), ...(dto.description !== undefined ? { description: dto.description.trim() } : {}), ...(dto.assignment_type !== undefined ? { assignment_type: dto.assignment_type } : {}), ...(dto.access_type !== undefined ? { access_type: dto.access_type } : {}), ...(dto.total_pages !== undefined ? { total_pages: dto.total_pages } : {}) } }); }
  async replaceDocument(user: CurrentUser, id: string, file?: Express.Multer.File) { const row = await this.db.assignment.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Assignment not found'); await this.manager(user, row.course_id); this.validatePdf(file); if (!cloudinaryConfigured()) throw new ServiceUnavailableException('Cloudinary storage is not configured'); const asset = await uploadCloudinaryFile(file!.buffer, 'application/pdf', `learnova/assignments/${randomUUID()}`, 'authenticated', 'raw'); const updated = await this.db.assignment.update({ where: { id }, data: { document_public_id: asset.public_id, document_url: asset.secure_url, document_resource_type: asset.resource_type, document_version: asset.version, document_bytes: asset.bytes, document_mime_type: 'application/pdf' } }); if (row.document_public_id) await deleteCloudinaryImage(row.document_public_id, 'authenticated', row.document_resource_type === 'raw' ? 'raw' : 'image').catch(() => undefined); return updated; }
  async publish(user: CurrentUser, id: string, published: boolean) { const row = await this.db.assignment.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Assignment not found'); await this.manager(user, row.course_id); return this.db.assignment.update({ where: { id }, data: { published, published_at: published ? new Date() : null } }); }
  async archive(user: CurrentUser, id: string, archived: boolean) { const row = await this.db.assignment.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Assignment not found'); await this.manager(user, row.course_id); return this.db.assignment.update({ where: { id }, data: { archived } }); }
  async remove(user: CurrentUser, id: string) { const row = await this.db.assignment.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Assignment not found'); await this.manager(user, row.course_id); await this.db.assignment.delete({ where: { id } }); if (row.document_public_id) await deleteCloudinaryImage(row.document_public_id, 'authenticated', row.document_resource_type === 'raw' ? 'raw' : 'image').catch(() => undefined); return { deleted: true }; }
  async listStudent(user: CurrentUser) { const rows = await this.db.assignment.findMany({ where: { published: true, archived: false, course: { published: true, archived_at: null, visibility: 'PUBLIC' } }, include: { course: { select: { id: true, title: true } } }, orderBy: { published_at: 'desc' } }); const result = []; for (const row of rows) { if (row.access_type === 'FREE' || await this.courses.canAccess(user, row.course_id)) result.push(this.safe({ ...row, course_title: row.course.title })); } return result; }
  private async authorize(user: CurrentUser, id: string) { const row = await this.db.assignment.findUnique({ where: { id }, include: { course: { select: { id: true, title: true, published: true, archived_at: true, visibility: true } } } }); if (!row || row.archived || !row.published || !row.course.published || row.course.archived_at || row.course.visibility !== 'PUBLIC') throw new NotFoundException('Assignment not found'); const allowed = row.access_type === 'FREE' || await this.courses.canAccess(user, row.course_id); if (!allowed) { await this.db.assignmentAccessAttempt.create({ data: { assignment_id: row.id, student_id: user.id, reason: 'COURSE_ACCESS_REQUIRED' } }); throw new ForbiddenException('Course access required'); } return row; }
  async details(user: CurrentUser, id: string) { const row = await this.authorize(user, id); await this.recordView(user, id); return this.safe({ ...row, course_title: row.course.title }); }
  async page(user: CurrentUser, id: string, page: number) { const row = await this.authorize(user, id); if (page < 1 || page > row.total_pages) throw new NotFoundException('Assignment page not found'); await this.recordView(user, id, page); if (!row.document_url) throw new NotFoundException('Assignment document not found'); const pageUrl = row.document_url.replace('/upload/', `/upload/pg_${page}/w_1600,q_auto,f_jpg/`); const image = await fetchCloudinaryImage(pageUrl); return { content: await this.watermark(image, user), mime_type: 'image/jpeg' }; }
  async analytics(user: CurrentUser, id: string) { const row = await this.db.assignment.findUnique({ where: { id } }); if (!row) throw new NotFoundException('Assignment not found'); await this.manager(user, row.course_id); const [views, attempts] = await Promise.all([this.db.assignmentView.findMany({ where: { assignment_id: id }, include: { student: { select: { name: true, email: true } } }, orderBy: { last_viewed: 'desc' } }), this.db.assignmentAccessAttempt.count({ where: { assignment_id: id } })]); return { total_views: views.reduce((n, v) => n + v.view_count, 0), unique_students: views.length, unauthorized_attempts: attempts, viewers: views.map((v) => ({ student_name: v.student.name, email: v.student.email, first_viewed: v.first_viewed, last_viewed: v.last_viewed, view_count: v.view_count, last_page: v.last_page })) }; }
}
