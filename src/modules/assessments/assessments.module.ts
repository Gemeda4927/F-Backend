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
  Delete,
} from '@nestjs/common';
import sharp from 'sharp';
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
  IsObject,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { audit } from '../audit/audit.js';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import type { Assessment, Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CoursesService } from '../courses/courses.service.js';
import {
  validateBank,
  validateResponses,
  gradeBank,
  publicQuestion,
  answerReview,
  shuffled,
  type Question,
  type Responses,
  type Grade,
  applyWordingCorrections,
} from './questions.js';
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
  @IsOptional() @IsArray() @ArrayMaxSize(200) question_bank?: unknown[];
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsString() @MaxLength(120) chapter?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) passing_percent?: number;
  @IsOptional()
  @IsIn(['AFTER_SUBMISSION', 'AFTER_CLOSE', 'NEVER'])
  review_policy?: string;
  @IsOptional() @IsBoolean() randomize_questions?: boolean;
  @IsOptional() @IsBoolean() randomize_options?: boolean;
  @IsOptional() @IsBoolean() allow_navigation?: boolean;
  @IsOptional() @IsBoolean() allow_resume?: boolean;
  @IsOptional() @IsBoolean() practice?: boolean;
  @IsOptional() @IsInt() @Min(1) expected_revision?: number;
  @IsOptional() @IsDateString() opens_at?: string | null;
  @IsOptional() @IsDateString() due_at?: string | null;
  @IsOptional() @IsInt() @Min(1) @Max(1440) duration_minutes?: number | null;
  @IsOptional() @IsInt() @Min(1) @Max(10) max_attempts?: number;
  @IsOptional() @IsBoolean() results_published?: boolean;
  @IsOptional() @IsBoolean() allow_files?: boolean;
}
class OptionWordingDto {
  @IsString() @MinLength(1) @MaxLength(80) id!: string;
  @IsString() @MaxLength(2000) text!: string;
}
class QuestionWordingDto {
  @IsString() @MinLength(1) @MaxLength(80) id!: string;
  @IsOptional() @IsString() @MaxLength(10000) question?: string;
  @IsOptional() @IsString() @MaxLength(10000) explanation?: string;
  @IsOptional() @IsString() @MaxLength(10000) hint?: string;
  @IsOptional() @IsString() @MaxLength(10000) image_alt?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => OptionWordingDto)
  options?: OptionWordingDto[];
}
class WordingCorrectionsDto {
  @IsInt() @Min(1) expected_revision!: number;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(20000) prompt?: string;
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => QuestionWordingDto)
  questions!: QuestionWordingDto[];
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
  @IsOptional() @IsObject() responses?: Responses;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  marked?: string[];
  @IsOptional() @IsInt() @Min(0) save_version?: number;
  @IsOptional() @IsInt() @Min(1) expected_revision?: number;
  @IsOptional() @IsUUID() attempt_id?: string;
  @IsOptional() @IsUUID() attempt_key?: string;
  @IsOptional() @IsUUID() attachment_id?: string;
}
class ReviewDto {
  @IsInt() @Min(0) @Max(10000) score!: number;
  @IsString() @MaxLength(10000) feedback!: string;
  @IsOptional() @IsInt() @Min(1) expected_attempt?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(200) grading?: Grade[];
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
    const bank =
      dto.question_bank !== undefined
        ? validateBank(dto.question_bank, dto.published !== false)
        : undefined;
    if (dto.review_policy === 'AFTER_CLOSE' && !dto.due_at)
      throw new BadRequestException(
        'Set a closing date for review after closing',
      );
    if (bank?.length && dto.kind !== 'EXAM')
      throw new BadRequestException('Typed questions belong to exams');
    return {
      question_bank: bank as Prisma.InputJsonValue | undefined,
      structured: dto.question_bank !== undefined ? true : undefined,
      published: dto.published,
      chapter: dto.chapter,
      passing_percent: dto.passing_percent,
      review_policy: dto.review_policy,
      randomize_questions: dto.randomize_questions,
      randomize_options: dto.randomize_options,
      allow_navigation: dto.allow_navigation,
      allow_resume: dto.allow_resume,
      practice: dto.practice,
      title: dto.title,
      kind: dto.kind,
      prompt: dto.prompt,
      max_score: bank?.length
        ? bank.reduce((sum, q) => sum + q.points, 0)
        : dto.max_score,
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
    if (!a || (u.role === 'STUDENT' && !a.published))
      throw new NotFoundException('Assessment not found');
    if (u.role !== 'STUDENT') await this.courses.assertOwner(u, a.course_id);
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
      await this.checkImages(tx, a);
      if (a.published)
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
      const current = await tx.assessment.findUniqueOrThrow({ where: { id } });
      if (
        dto.expected_revision !== undefined &&
        dto.expected_revision !== current.revision
      )
        throw new ConflictException(
          'This exam changed in another editor; reload before saving',
        );
      const updated = await tx.assessment.update({
        where: { id },
        data: {
          ...this.data(
            current.structured
              ? Object.assign(new AssessmentDto(), dto, {
                  question_bank:
                    dto.question_bank ?? (current.question_bank as unknown[]),
                })
              : dto,
          ),
          revision: { increment: 1 },
        },
      });
      await this.checkImages(tx, updated);
      if (updated.published && !current.published)
        await notifyCourse(tx, updated.course_id, {
          event_key: `assessment:${id}`,
          kind: updated.kind,
          title: `New exam: ${updated.title}`,
          message: 'A new exam is ready in your course.',
          href: `/learn/${updated.course_id}/activities/${id}?type=assessment`,
        });
      return updated;
    });
  }
  /** Typo and wording fixes for exams that already have attempts; grading data stays locked. */
  @Permissions('courses:write') @Patch(':id/corrections') async corrections(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: WordingCorrectionsDto,
  ) {
    const a = await this.allowed(u, id);
    await this.courses.assertOwner(u, a.course_id);
    return this.db.atomic(async (tx) => {
      const current = await tx.assessment.findUniqueOrThrow({ where: { id } });
      if (dto.expected_revision !== current.revision)
        throw new ConflictException(
          'This exam changed in another editor; reload before saving',
        );
      const { bank, changed } = applyWordingCorrections(
        current.question_bank as unknown as Question[],
        dto.questions,
      );
      validateBank(bank, current.published);
      const updated = await tx.assessment.update({
        where: { id },
        data: {
          question_bank: bank as unknown as Prisma.InputJsonValue,
          title: dto.title ?? current.title,
          prompt: dto.prompt ?? current.prompt,
          revision: { increment: 1 },
        },
      });
      await audit(tx, {
        actor: u,
        target: u.id,
        action: 'ASSESSMENT_WORDING_CORRECTED',
        description: `Wording corrected in ${updated.title}`,
        resourceType: 'ASSESSMENT',
        resourceId: id,
        metadata: {
          questions: changed,
          title_changed: updated.title !== current.title,
          prompt_changed: updated.prompt !== current.prompt,
        },
      });
      return updated;
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
      where: u.role === 'STUDENT' ? { ...where, published: true } : where,
      orderBy: { created_at: 'desc' },
      include: {
        _count: { select: { attempts: true, submissions: true } },
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
            responses: true,
            marked: true,
            grading: true,
            saved_at: true,
            save_version: true,
            question_order: true,
            option_order: true,
          },
          orderBy: { number: 'desc' },
        },
      },
    });
    return rows.map((a) => {
      const student = u.role === 'STUDENT';
      const active = a.attempts.find(
        (t) => !t.submitted_at && (!t.expires_at || t.expires_at > new Date()),
      );
      const bank = a.question_bank as Question[];
      const canReview =
        student &&
        !!a.submissions[0]?.reviewed_at &&
        a.results_published &&
        a.review_policy !== 'NEVER' &&
        (a.review_policy !== 'AFTER_CLOSE' ||
          (!!a.due_at && a.due_at <= new Date()));
      const visible = !student || !!active || canReview;
      const attemptOrder = active?.question_order ?? [];
      const ordered = attemptOrder.length
        ? attemptOrder
            .map((id) => bank.find((q) => q.id === id)!)
            .filter(Boolean)
        : bank;
      return {
        ...a,
        question_count: bank.length || (a.questions as string[]).length,
        question_bank: !student
          ? bank
          : visible
            ? ordered.map((q) => {
                const safe = publicQuestion(q);
                const order = (
                  active?.option_order as Record<string, string[]> | undefined
                )?.[q.id];
                return {
                  ...safe,
                  options: order
                    ? order
                        .map((id) => safe.options?.find((o) => o.id === id))
                        .filter(
                          (option): option is NonNullable<typeof option> =>
                            !!option,
                        )
                    : safe.options,
                };
              })
            : [],
        typed: a.structured || !!bank.length,
        has_attempts:
          !student && (a._count.attempts > 0 || a._count.submissions > 0),
        answer_review: canReview ? bank.map(answerReview) : [],
        questions:
          student && a.kind === 'EXAM' && !a.submissions.length && !active
            ? []
            : a.questions,
        server_now: new Date().toISOString(),
        attempts: a.attempts.map((t) => ({
          ...t,
          responses: !t.submitted_at && a.allow_resume ? t.responses : {},
          grading: canReview || !student ? t.grading : [],
        })),
        submissions: a.submissions.map((s) =>
          a.results_published || !student
            ? {
                ...s,
                grading: canReview || !student ? s.grading : [],
                pending_review: !s.reviewed_at,
              }
            : {
                ...s,
                score: null,
                feedback: null,
                reviewed_at: null,
                grading: [],
                pending_review: !s.reviewed_at,
              },
        ),
      };
    });
  }
  @Get('course/:courseId') async list(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    if (u.role !== 'STUDENT') await this.courses.assertOwner(u, courseId);
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
    if (a.published === false)
      throw new ForbiddenException('This exam is a draft');
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
    ) {
      if (!a.allow_resume)
        throw new ConflictException(
          'Resuming this exam is disabled; contact your instructor',
        );
      return latest;
    }
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
        question_order: a.randomize_questions
          ? shuffled(((a.question_bank ?? []) as Question[]).map((q) => q.id))
          : ((a.question_bank ?? []) as Question[]).map((q) => q.id),
        option_order: Object.fromEntries(
          ((a.question_bank ?? []) as Question[])
            .filter((q) => q.options)
            .map((q) => [
              q.id,
              a.randomize_options
                ? shuffled(q.options!.map((o) => o.id))
                : q.options!.map((o) => o.id),
            ]),
        ),
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
      if (attempt.submitted_at) {
        if (!a.structured)
          throw new ConflictException('This attempt was already submitted');
        const prior = await tx.assessmentSubmission.findUnique({
          where: {
            assessment_id_student_id: { assessment_id: id, student_id: u.id },
          },
        });
        if (prior?.attempt_number === attempt.number)
          return {
            id: prior.id,
            assessment_id: prior.assessment_id,
            attempt_number: prior.attempt_number,
            submitted_at: prior.submitted_at,
            score: a.results_published ? prior.score : null,
            pending_review: !prior.reviewed_at,
          };
        throw new ConflictException('This attempt was already submitted');
      }
      assertAvailable(a);
      if (attempt.expires_at && new Date() >= attempt.expires_at)
        throw new ForbiddenException(
          'Time has expired; this attempt cannot be submitted',
        );
      if (
        a.allow_resume === false &&
        !attempt.submitted_at &&
        dto.attempt_key !== attempt.access_key
      )
        throw new ForbiddenException(
          'This attempt cannot be resumed after leaving the page',
        );
      if (((a.question_bank ?? []) as Question[]).length)
        return this.submitTyped(tx, u, a, attempt, dto);
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
  private async checkImages(tx: Prisma.TransactionClient, a: Assessment) {
    const bank = (a.question_bank ?? []) as Question[];
    const ids = [
      ...new Set(
        bank
          .flatMap((q) => [
            q.image_id,
            ...(q.options ?? []).map((o) => o.image_id),
          ])
          .filter((id): id is string => !!id),
      ),
    ];
    if (
      ids.length &&
      (await tx.assessmentImage.count({
        where: { id: { in: ids }, assessment_id: a.id },
      })) !== ids.length
    )
      throw new BadRequestException('Question images must belong to this exam');
  }
  private async submitTyped(
    tx: Prisma.TransactionClient,
    u: CurrentUser,
    a: Assessment,
    attempt: {
      id: string;
      number: number;
      responses: Prisma.JsonValue;
      save_version: number;
    },
    dto: AnswerDto,
  ) {
    if (dto.save_version !== attempt.save_version)
      throw new ConflictException(
        'Answers changed in another tab. Reload before submitting',
      );
    const bank = a.question_bank as Question[];
    const responses = validateResponses(
      bank,
      dto.responses ?? attempt.responses,
    );
    if (
      dto.expected_revision !== undefined &&
      dto.expected_revision !== a.revision
    )
      throw new ConflictException('Exam changed; reload before submitting');
    const grading = gradeBank(bank, responses);
    const complete = grading.every((g) => g.earned !== null);
    const score = complete
      ? Math.round(grading.reduce((sum, g) => sum + g.earned!, 0))
      : null;
    const now = new Date();
    const answer = bank
      .map((q, i) => {
        const v = responses[q.id];
        const response =
          q.options && Array.isArray(v)
            ? v
                .map((id) => q.options!.find((o) => o.id === id)?.text ?? id)
                .join(', ')
            : Array.isArray(v)
              ? v.join(' | ')
              : String(v ?? '(unanswered)');
        return `${i + 1}. ${q.question}\n${response}`;
      })
      .join('\n\n');
    const data = {
      answer,
      score,
      grading: grading as Prisma.InputJsonValue,
      feedback: null,
      reviewed_at: complete ? now : null,
      submitted_at: now,
      attempt_number: attempt.number,
      attachment_id: null,
    };
    await tx.assessmentAttempt.update({
      where: { id: attempt.id },
      data: {
        answer,
        score,
        grading: grading as Prisma.InputJsonValue,
        responses,
        submitted_at: now,
      },
    });
    const s = await tx.assessmentSubmission.upsert({
      where: {
        assessment_id_student_id: { assessment_id: a.id, student_id: u.id },
      },
      create: { assessment_id: a.id, student_id: u.id, ...data },
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
      message: complete
        ? 'Objective questions graded automatically.'
        : `${u.name} submitted work requiring review.`,
      href: '/dashboard/instructor/reviews',
    });
    return {
      id: s.id,
      assessment_id: s.assessment_id,
      attempt_number: s.attempt_number,
      submitted_at: s.submitted_at,
      score: a.results_published ? s.score : null,
      pending_review: !s.reviewed_at,
    };
  }
  @Patch(':id/draft') async autosave(
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
      if (!a.published || !(await this.courses.canAccess(u, a.course_id, tx)))
        throw new ForbiddenException('Course access required');
      const t = await tx.assessmentAttempt.findFirst({
        where: {
          id: dto.attempt_id ?? '00000000-0000-0000-0000-000000000000',
          assessment_id: id,
          student_id: u.id,
        },
      });
      if (!t || t.submitted_at || (t.expires_at && t.expires_at <= new Date()))
        throw new ConflictException('This attempt is no longer active');
      if (a.allow_resume === false && dto.attempt_key !== t.access_key)
        throw new ForbiddenException(
          'This attempt cannot be resumed after leaving the page',
        );
      if (dto.save_version !== t.save_version)
        throw new ConflictException(
          'Answers changed in another tab. Reload before continuing',
        );
      const bank = a.question_bank as Question[];
      const responses = validateResponses(bank, dto.responses);
      const marked = dto.marked ?? [];
      if (marked.some((id) => !bank.some((q) => q.id === id)))
        throw new BadRequestException('Unknown marked question');
      const updated = await tx.assessmentAttempt.update({
        where: { id: t.id },
        data: {
          responses,
          marked,
          saved_at: new Date(),
          save_version: { increment: 1 },
        },
      });
      return { saved_at: updated.saved_at, save_version: updated.save_version };
    });
  }
  @Permissions('courses:write') @Post(':id/duplicate') async duplicate(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const a = await this.allowed(u, id);
    await this.courses.assertOwner(u, a.course_id);
    return this.db.atomic(async (tx) => {
      const original = await tx.assessment.findUniqueOrThrow({ where: { id } });
      const { id: oldId, created_at, revision, ...values } = original;
      void oldId;
      void created_at;
      void revision;
      const copy = await tx.assessment.create({
        data: {
          ...values,
          title: `${original.title.slice(0, 150)} (copy)`,
          published: false,
          question_bank: original.question_bank as Prisma.InputJsonValue,
          questions: original.questions as Prisma.InputJsonValue,
        },
      });
      const images = await tx.assessmentImage.findMany({
        where: { assessment_id: id },
      });
      const map = new Map<string, string>();
      for (const image of images) {
        const uploaded = await tx.assessmentImage.create({
          data: {
            assessment_id: copy.id,
            name: image.name,
            mime_type: image.mime_type,
            content: image.content,
          },
        });
        map.set(image.id, uploaded.id);
      }
      const bank = (original.question_bank as Question[]).map((q) => ({
        ...q,
        image_id: q.image_id ? map.get(q.image_id) : undefined,
        options: q.options?.map((o) => ({
          ...o,
          image_id: o.image_id ? map.get(o.image_id) : undefined,
        })),
      }));
      return tx.assessment.update({
        where: { id: copy.id },
        data: { question_bank: bank as Prisma.InputJsonValue },
      });
    });
  }
  @Permissions('courses:write') @Delete(':id') async remove(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const a = await this.allowed(u, id);
    await this.courses.assertOwner(u, a.course_id);
    return this.db.atomic(async (tx) => {
      if (
        (await tx.assessmentAttempt.count({ where: { assessment_id: id } })) ||
        (await tx.assessmentSubmission.count({
          where: { assessment_id: id },
        })) ||
        (await tx.assessmentFile.count({ where: { assessment_id: id } }))
      )
        throw new ConflictException(
          'An exam with student work cannot be deleted',
        );
      await tx.assessment.delete({ where: { id } });
      return { deleted: true };
    });
  }
  @Permissions('courses:write')
  @Post(':id/images')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  async uploadImage(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    const a = await this.allowed(u, id);
    await this.courses.assertOwner(u, a.course_id);
    const b = file?.buffer;
    const png =
      b &&
      b.length > 24 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg =
      b &&
      b.length > 4 &&
      b[0] === 255 &&
      b[1] === 216 &&
      b[2] === 255 &&
      b[b.length - 2] === 255 &&
      b[b.length - 1] === 217;
    const webp =
      b &&
      b.length > 16 &&
      b.subarray(0, 4).toString() === 'RIFF' &&
      b.subarray(8, 12).toString() === 'WEBP';
    const mime = png
      ? 'image/png'
      : jpeg
        ? 'image/jpeg'
        : webp
          ? 'image/webp'
          : null;
    if (!file || !mime || mime !== file.mimetype)
      throw new BadRequestException(
        'Upload a PNG, JPEG, or WebP image, up to 2 MB',
      );
    let content: Buffer;
    try {
      content = await sharp(file.buffer, { limitInputPixels: 16000000 })
        .rotate()
        .toFormat(png ? 'png' : jpeg ? 'jpeg' : 'webp')
        .toBuffer();
    } catch {
      throw new BadRequestException('The image could not be decoded safely');
    }
    if (content.length > 2 * 1024 * 1024)
      throw new BadRequestException('The processed image exceeds 2 MB');
    return this.db.atomic(async (tx) => {
      if (
        (await tx.assessmentImage.count({ where: { assessment_id: id } })) >=
        100
      )
        throw new ConflictException('Image limit reached (100 per exam)');
      return tx.assessmentImage.create({
        data: {
          assessment_id: id,
          name: file.originalname
            .replace(/[^a-zA-Z0-9._ -]/g, '_')
            .slice(0, 120),
          mime_type: mime,
          content: Uint8Array.from(content),
        },
        select: { id: true, name: true },
      });
    });
  }
  @Get('images/:imageId') async image(
    @User() u: CurrentUser,
    @Param('imageId', ParseUUIDPipe) imageId: string,
    @Res() res: Response,
  ) {
    const image = await this.db.assessmentImage.findUnique({
      where: { id: imageId },
      include: { assessment: true },
    });
    if (!image) throw new NotFoundException();
    const a = await this.allowed(u, image.assessment_id);
    if (u.role === 'STUDENT') {
      const item = (await this.items(u, { id: a.id }))[0];
      const qs = item.question_bank as ReturnType<typeof publicQuestion>[];
      if (
        !qs.some(
          (q) =>
            q.image_id === imageId ||
            q.options?.some((o) => o.image_id === imageId),
        )
      )
        throw new ForbiddenException('Start this exam to view its images');
    }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.mime_type).send(Buffer.from(image.content));
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
    let grading = s.grading as Grade[];
    if (((s.assessment.question_bank ?? []) as Question[]).length) {
      if (!Array.isArray(dto.grading) || dto.grading.length !== grading.length)
        throw new BadRequestException('Review every question');
      grading = grading.map((g) => {
        const provided = dto.grading!.filter((x) => x.id === g.id);
        if (provided.length !== 1)
          throw new BadRequestException('Invalid question grades');
        const p = provided[0];
        if (
          typeof p.earned !== 'number' ||
          !Number.isFinite(p.earned) ||
          p.earned < 0 ||
          p.earned > g.points ||
          (p.feedback !== undefined &&
            (typeof p.feedback !== 'string' || p.feedback.length > 2000))
        )
          throw new BadRequestException('Question grade exceeds its marks');
        return {
          ...g,
          earned: Math.round(p.earned * 100) / 100,
          feedback: p.feedback,
        };
      });
      dto.score = Math.round(grading.reduce((sum, g) => sum + g.earned!, 0));
    }
    return this.db.atomic(async (tx) => {
      const updated = await tx.assessmentSubmission.updateMany({
        where: { id, attempt_number: dto.expected_attempt ?? s.attempt_number },
        data: {
          score: dto.score,
          grading: grading as Prisma.InputJsonValue,
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
        data: {
          score: dto.score,
          feedback: dto.feedback,
          grading: grading as Prisma.InputJsonValue,
        },
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
        grading,
        score: dto.score,
        feedback: dto.feedback,
        reviewed_at: new Date(),
      };
    });
  }
}
@Module({ imports: [CoursesModule], controllers: [AssessmentsController] })
export class AssessmentsModule {}
