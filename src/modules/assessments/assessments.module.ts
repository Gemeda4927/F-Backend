import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import type { Assessment, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CoursesService } from '../courses/courses.service.js';
import { notify, notifyCourse } from '../notifications/notifications.js';

class AssessmentDto {
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsIn(['EXAM', 'ASSIGNMENT']) kind!: string;
  @IsString() @MinLength(3) @MaxLength(20000) prompt!: string;
  @IsInt() @Min(1) @Max(10000) max_score!: number;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(3, { each: true })
  @MaxLength(2000, { each: true })
  questions?: string[];
  @IsOptional() @IsDateString() opens_at?: string | null;
  @IsOptional() @IsDateString() due_at?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(10) max_attempts?: number;
  @IsOptional() @IsBoolean() results_published?: boolean;
  @IsOptional() @IsBoolean() allow_files?: boolean;
}
class AnswerDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50000) answer?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(2000, { each: true })
  answers?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  expected_questions?: string[];
  @IsOptional() @IsString() @MaxLength(20000) expected_prompt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) expected_max_score?: number;
  @IsOptional() @IsUUID() attempt_id?: string;
  @IsOptional() @IsUUID() attachment_id?: string;
}
class ReviewDto {
  @IsInt() @Min(0) @Max(10000) score!: number;
  @IsString() @MaxLength(10000) feedback!: string;
  @IsOptional() @IsInt() @Min(1) expected_attempt?: number;
}
class ResultDto {
  @IsBoolean() results_published!: boolean;
}
export function assertAvailable(
  a: Pick<Assessment, 'opens_at' | 'due_at'>,
  now = new Date(),
) {
  if (a.opens_at && now < a.opens_at)
    throw new ForbiddenException('This activity is not open yet');
  if (a.due_at && now >= a.due_at)
    throw new ForbiddenException('The submission deadline has passed');
}
const courseInfo = {
  select: {
    id: true,
    title: true,
    instructor_id: true,
    instructor: { select: { name: true } },
  },
} as const;
const attachmentInfo = {
  select: { id: true, name: true, mime_type: true },
} as const;
@Controller('assessments')
export class AssessmentsController {
  constructor(
    private readonly db: PrismaService,
    private readonly courses: CoursesService,
  ) {}
  private data(dto: AssessmentDto) {
    if (
      dto.opens_at &&
      dto.due_at &&
      new Date(dto.opens_at) >= new Date(dto.due_at)
    )
      throw new BadRequestException('Deadline must be after the opening time');
    if (dto.kind !== 'EXAM' && dto.duration_minutes)
      throw new BadRequestException('Only exams can be timed');
    return {
      title: dto.title,
      kind: dto.kind,
      prompt: dto.prompt,
      max_score: dto.max_score,
      questions: dto.questions,
      duration_minutes: dto.duration_minutes,
      max_attempts: dto.max_attempts,
      results_published: dto.results_published,
      allow_files: dto.allow_files,
      opens_at: dto.opens_at ? new Date(dto.opens_at) : dto.opens_at,
      due_at: dto.due_at ? new Date(dto.due_at) : dto.due_at,
    };
  }
  private async allowed(u: CurrentUser, id: string) {
    const a = await this.db.assessment.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Assessment not found');
    if (!(await this.courses.canAccess(u, a.course_id)))
      throw new ForbiddenException('Course access required');
    return a;
  }
  @Permissions('courses:write') @Post('course/:courseId') async create(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: AssessmentDto,
  ) {
    await this.courses.assertOwner(u, courseId);
    return this.db.atomic(async (tx) => {
      const a = await tx.assessment.create({
        data: { ...this.data(dto), course_id: courseId },
      });
      await notifyCourse(tx, courseId, {
        event_key: `assessment:${a.id}`,
        kind: a.kind,
        title: `New ${a.kind.toLowerCase()}: ${a.title}`,
        message: a.due_at
          ? `Due ${a.due_at.toISOString()}`
          : 'A new activity is ready in your course.',
        href: `/learn/${courseId}/activities/${a.id}?type=assessment`,
      });
      return a;
    });
  }
  @Permissions('courses:write') @Get('reviews') async reviews(
    @User() u: CurrentUser,
  ) {
    const rows = await this.db.assessmentSubmission.findMany({
      where: {
        assessment: {
          course: ['ADMIN', 'SUPER_ADMIN'].includes(u.role)
            ? {}
            : { instructor_id: u.id },
        },
      },
      include: {
        attachment: attachmentInfo,
        assessment: { include: { course: courseInfo } },
        student: { select: { name: true } },
      },
      orderBy: { submitted_at: 'desc' },
      take: 100,
    });
    return rows.map(({ student, ...item }) => ({
      ...item,
      student_name: student.name,
    }));
  }
  @Permissions('courses:write') @Patch(':id') async update(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssessmentDto,
  ) {
    const a = await this.allowed(u, id);
    await this.courses.assertOwner(u, a.course_id);
    return this.db.atomic(async (tx) => {
      if (
        (await tx.assessmentSubmission.count({
          where: { assessment_id: id },
        })) ||
        (await tx.assessmentAttempt.count({ where: { assessment_id: id } }))
      )
        throw new ConflictException(
          'Activities with attempts or submissions cannot be edited; publish results separately',
        );
      return tx.assessment.update({ where: { id }, data: this.data(dto) });
    });
  }
  @Permissions('courses:write') @Patch(':id/results') async publish(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResultDto,
  ) {
    const a = await this.allowed(u, id);
    await this.courses.assertOwner(u, a.course_id);
    return this.db.atomic(async (tx) => {
      const current = await tx.assessment.findUniqueOrThrow({ where: { id } });
      const updated = await tx.assessment.update({ where: { id }, data: dto });
      if (dto.results_published && !current.results_published) {
        const submissions = await tx.assessmentSubmission.findMany({
          where: { assessment_id: id, reviewed_at: { not: null } },
          select: { student_id: true },
        });
        await notify(
          tx,
          submissions.map((x) => x.student_id),
          {
            course_id: a.course_id,
            event_key: `results:${id}:${new Date().toISOString()}`,
            kind: 'RESULT',
            title: `Results published: ${a.title}`,
            message: 'Your grade and instructor feedback are now available.',
            href: `/learn/${a.course_id}/activities/${id}?type=assessment`,
          },
        );
      }
      return updated;
    });
  }
  private async items(u: CurrentUser, where: Prisma.AssessmentWhereInput) {
    const rows = await this.db.assessment.findMany({
      where,
      orderBy: { created_at: 'desc' },
      include: {
        course: courseInfo,
        submissions: {
          where: { student_id: u.id },
          include: { attachment: attachmentInfo },
        },
        attempts: {
          where: { student_id: u.id },
          select: {
            id: true,
            number: true,
            started_at: true,
            expires_at: true,
            submitted_at: true,
          },
          orderBy: { number: 'desc' },
        },
      },
    });
    return rows.map((a) => ({
      ...a,
      question_count: (a.questions as string[]).length,
      questions:
        u.role === 'STUDENT' &&
        a.kind === 'EXAM' &&
        !a.submissions.length &&
        !a.attempts.some(
          (attempt) =>
            !attempt.submitted_at &&
            (!attempt.expires_at || attempt.expires_at > new Date()),
        )
          ? []
          : a.questions,
      server_now: new Date().toISOString(),
      submissions: a.submissions.map((s) =>
        a.results_published || u.role !== 'STUDENT'
          ? s
          : { ...s, score: null, feedback: null, reviewed_at: null },
      ),
    }));
  }
  @Get('course/:courseId') async list(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    if (!(await this.courses.canAccess(u, courseId)))
      throw new ForbiddenException('Course access required');
    return this.items(u, { course_id: courseId });
  }
  @Get(':id') async detail(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.allowed(u, id);
    return (await this.items(u, { id }))[0];
  }
  @Permissions('courses:write')
  @Get('course/:courseId/submissions')
  async submissions(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    await this.courses.assertOwner(u, courseId);
    const rows = await this.db.assessmentSubmission.findMany({
      where: { assessment: { course_id: courseId } },
      include: {
        attachment: attachmentInfo,
        assessment: true,
        student: { select: { name: true } },
      },
      orderBy: { submitted_at: 'desc' },
    });
    return rows.map(({ student, ...s }) => ({
      ...s,
      student_name: student.name,
    }));
  }
  private async startAttempt(
    tx: Prisma.TransactionClient,
    u: CurrentUser,
    a: Assessment,
  ) {
    assertAvailable(a);
    if (!(await this.courses.canAccess(u, a.course_id, tx)))
      throw new ForbiddenException('Course access required');
    const latest = await tx.assessmentAttempt.findFirst({
      where: { assessment_id: a.id, student_id: u.id },
      orderBy: { number: 'desc' },
    });
    const prior = await tx.assessmentSubmission.findUnique({
      where: {
        assessment_id_student_id: { assessment_id: a.id, student_id: u.id },
      },
    });
    if (
      latest &&
      !latest.submitted_at &&
      (!latest.expires_at || latest.expires_at > new Date())
    )
      return latest;
    const used = Math.max(latest?.number ?? 0, prior?.attempt_number ?? 0);
    if (used >= a.max_attempts)
      throw new ConflictException('Attempt limit reached');
    const expires = a.duration_minutes
      ? new Date(Date.now() + a.duration_minutes * 60000)
      : null;
    return tx.assessmentAttempt.create({
      data: {
        assessment_id: a.id,
        student_id: u.id,
        number: used + 1,
        expires_at:
          expires && a.due_at && a.due_at < expires ? a.due_at : expires,
      },
    });
  }
  @Post(':id/start') async start(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    if (u.role !== 'STUDENT')
      throw new ForbiddenException('Student account required');
    await this.allowed(u, id);
    return this.db.atomic(async (tx) => {
      const a = await tx.assessment.findUniqueOrThrow({ where: { id } });
      return {
        ...(await this.startAttempt(tx, u, a)),
        server_now: new Date().toISOString(),
      };
    });
  }
  @Post(':id/submit') async submit(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnswerDto,
  ) {
    if (u.role !== 'STUDENT')
      throw new ForbiddenException('Student account required');
    await this.allowed(u, id);
    return this.db.atomic(async (tx) => {
      const a = await tx.assessment.findUniqueOrThrow({ where: { id } });
      assertAvailable(a);
      if (!(await this.courses.canAccess(u, a.course_id, tx)))
        throw new ForbiddenException('Course access required');
      const attempt = dto.attempt_id
        ? await tx.assessmentAttempt.findFirst({
            where: { id: dto.attempt_id, assessment_id: id, student_id: u.id },
          })
        : a.duration_minutes
          ? null
          : await this.startAttempt(tx, u, a);
      if (!attempt)
        throw new ConflictException('Start this activity before submitting');
      if (attempt.submitted_at)
        throw new ConflictException('This attempt was already submitted');
      if (attempt.expires_at && new Date() >= attempt.expires_at)
        throw new ForbiddenException(
          'Time has expired; this attempt cannot be submitted',
        );
      const questions = a.questions as string[];
      if (
        questions.length &&
        (dto.expected_max_score !== a.max_score ||
          dto.expected_prompt !== a.prompt ||
          JSON.stringify(dto.expected_questions) !== JSON.stringify(questions))
      )
        throw new ConflictException(
          'Assessment changed; reload it before submitting',
        );
      let file: { id: string } | null = null;
      if (dto.attachment_id) {
        if (!a.allow_files || a.kind !== 'ASSIGNMENT')
          throw new BadRequestException('Attachments are not enabled');
        file = await tx.assessmentFile.findFirst({
          where: {
            id: dto.attachment_id,
            assessment_id: id,
            student_id: u.id,
            submission: null,
          },
          select: { id: true },
        });
        if (!file) throw new ForbiddenException('Attachment is unavailable');
      }
      if (
        questions.length &&
        (!dto.answers ||
          dto.answers.length !== questions.length ||
          dto.answers.some((x) => !x.trim())) &&
        !file
      )
        throw new BadRequestException(
          'Answer every question or attach your response when permitted',
        );
      const answer =
        questions.length && dto.answers?.length === questions.length
          ? questions
              .map((q, i) => `${i + 1}. ${q}\n${dto.answers![i].trim()}`)
              .join('\n\n')
          : dto.answer?.trim() ||
            (file ? 'Response provided in attachment.' : '');
      if (!answer)
        throw new BadRequestException(
          'Enter your answer or attach a permitted response',
        );
      const now = new Date();
      await tx.assessmentAttempt.update({
        where: { id: attempt.id },
        data: { submitted_at: now, answer },
      });
      const data = {
        answer,
        submitted_at: now,
        attempt_number: attempt.number,
        attachment_id: file?.id ?? null,
        score: null,
        feedback: null,
        reviewed_at: null,
      };
      const s = await tx.assessmentSubmission.upsert({
        where: {
          assessment_id_student_id: { assessment_id: id, student_id: u.id },
        },
        create: { assessment_id: id, student_id: u.id, ...data },
        update: data,
      });
      const course = await tx.course.findUniqueOrThrow({
        where: { id: a.course_id },
      });
      await notify(tx, [course.instructor_id], {
        course_id: a.course_id,
        event_key: `submission:${attempt.id}`,
        kind: 'SUBMISSION',
        title: `New submission: ${a.title}`,
        message: `${u.name} submitted attempt ${attempt.number}.`,
        href: '/dashboard/instructor/reviews',
      });
      return s;
    });
  }
  @Post(':id/attachment')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  async upload(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (u.role !== 'STUDENT')
      throw new ForbiddenException('Student account required');
    const a = await this.allowed(u, id);
    assertAvailable(a);
    if (a.kind !== 'ASSIGNMENT' || !a.allow_files)
      throw new ForbiddenException('File submissions are not enabled');
    if (!file?.buffer?.length)
      throw new BadRequestException(
        'Choose a PDF or plain text file, maximum 5 MB',
      );
    const pdf =
      file.mimetype === 'application/pdf' &&
      file.buffer.subarray(0, 5).toString() === '%PDF-';
    const text =
      file.mimetype === 'text/plain' &&
      !file.buffer.includes(0) &&
      !file.buffer.toString('utf8').includes('\uFFFD');
    if (!pdf && !text)
      throw new BadRequestException(
        'Only valid PDF and UTF-8 text files are accepted',
      );
    return this.db.atomic(async (tx) => {
      const current = await tx.assessment.findUniqueOrThrow({ where: { id } });
      assertAvailable(current);
      if (
        !current.allow_files ||
        !(await this.courses.canAccess(u, current.course_id, tx))
      )
        throw new ForbiddenException('File submissions are not enabled');
      const prior = await tx.assessmentSubmission.findUnique({
        where: {
          assessment_id_student_id: { assessment_id: id, student_id: u.id },
        },
      });
      if ((prior?.attempt_number ?? 0) >= current.max_attempts)
        throw new ConflictException('Attempt limit reached');
      if (
        (await tx.assessmentFile.count({
          where: { assessment_id: id, student_id: u.id },
        })) >= 20
      )
        throw new ConflictException(
          'Attachment limit reached; contact your instructor',
        );
      return tx.assessmentFile.create({
        data: {
          assessment_id: id,
          student_id: u.id,
          name: file.originalname
            .replace(/[^a-zA-Z0-9._ -]/g, '_')
            .slice(0, 120),
          mime_type: pdf ? 'application/pdf' : 'text/plain',
          content: Uint8Array.from(file.buffer),
        },
        select: { id: true, name: true, mime_type: true },
      });
    });
  }
  @Get('attachments/:fileId') async download(
    @User() u: CurrentUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() res: Response,
  ) {
    const file = await this.db.assessmentFile.findUnique({
      where: { id: fileId },
      include: { assessment: true },
    });
    if (!file) throw new NotFoundException();
    if (u.id === file.student_id) {
      if (!(await this.courses.canAccess(u, file.assessment.course_id)))
        throw new ForbiddenException('Course access required');
    } else await this.courses.assertOwner(u, file.assessment.course_id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
    res.type(file.mime_type).send(Buffer.from(file.content));
  }
  @Permissions('courses:write') @Patch('submissions/:id/review') async review(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    const s = await this.db.assessmentSubmission.findUnique({
      where: { id },
      include: { assessment: true },
    });
    if (!s) throw new NotFoundException('Submission not found');
    await this.courses.assertOwner(u, s.assessment.course_id);
    if (dto.score > s.assessment.max_score)
      throw new ConflictException('Score exceeds maximum');
    return this.db.atomic(async (tx) => {
      const updated = await tx.assessmentSubmission.updateMany({
        where: { id, attempt_number: dto.expected_attempt ?? s.attempt_number },
        data: {
          score: dto.score,
          feedback: dto.feedback,
          reviewed_at: new Date(),
        },
      });
      if (!updated.count)
        throw new ConflictException(
          'The student resubmitted; reload before grading',
        );
      await tx.assessmentAttempt.updateMany({
        where: {
          assessment_id: s.assessment_id,
          student_id: s.student_id,
          number: s.attempt_number,
        },
        data: { score: dto.score, feedback: dto.feedback },
      });
      if (
        (
          await tx.assessment.findUniqueOrThrow({
            where: { id: s.assessment_id },
          })
        ).results_published
      )
        await notify(tx, [s.student_id], {
          course_id: s.assessment.course_id,
          event_key: `graded:${id}:${s.attempt_number}:${new Date().toISOString()}`,
          kind: 'GRADE',
          title: `Feedback ready: ${s.assessment.title}`,
          message: 'Your instructor has reviewed your work.',
          href: `/learn/${s.assessment.course_id}/activities/${s.assessment_id}?type=assessment`,
        });
      return {
        ...s,
        score: dto.score,
        feedback: dto.feedback,
        reviewed_at: new Date(),
      };
    });
  }
}
@Module({ imports: [CoursesModule], controllers: [AssessmentsController] })
export class AssessmentsModule {}
