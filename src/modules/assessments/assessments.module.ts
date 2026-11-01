import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CoursesService } from '../courses/courses.service.js';

class AssessmentDto {
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsIn(['EXAM', 'ASSIGNMENT']) kind!: string;
  @IsString() @MinLength(3) @MaxLength(20000) prompt!: string;
  @IsInt() @Min(1) @Max(10000) max_score!: number;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MinLength(3, { each: true }) @MaxLength(2000, { each: true }) questions?: string[];
}
class AnswerDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(50000) answer?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(2000, { each: true }) answers?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) expected_questions?: string[];
  @IsOptional() @IsString() @MaxLength(20000) expected_prompt?: string;
  @IsOptional() @IsInt() @Min(1) @Max(10000) expected_max_score?: number;
}
class ReviewDto {
  @IsInt() @Min(0) @Max(10000) score!: number;
  @IsString() @MaxLength(10000) feedback!: string;
}

@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly db: PrismaService, private readonly courses: CoursesService) {}
  @Permissions('courses:write') @Post('course/:courseId') async create(@User() u: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string, @Body() dto: AssessmentDto) {
    await this.courses.assertOwner(u, courseId);
    return this.db.assessment.create({ data: { title: dto.title, kind: dto.kind, prompt: dto.prompt, max_score: dto.max_score, questions: dto.questions, course_id: courseId } });
  }
  @Permissions('courses:write') @Get('reviews') async reviews(@User() u: CurrentUser) {
    const rows = await this.db.assessmentSubmission.findMany({
      where: { assessment: { course: { instructor_id: u.id } } },
      include: { assessment: { select: { course_id: true, title: true, kind: true, prompt: true, max_score: true, course: { select: { title: true } } } }, student: { select: { name: true } } },
      orderBy: { submitted_at: 'desc' }, take: 100,
    });
    return rows.map(({ student, ...item }) => ({ ...item, student_name: student.name }));
  }
  @Permissions('courses:write') @Patch(':id') async update(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssessmentDto) {
    const assessment = await this.db.assessment.findUnique({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    await this.courses.assertOwner(u, assessment.course_id);
    return this.db.atomic(async tx => {
      if (await tx.assessmentSubmission.count({ where: { assessment_id: id } })) throw new ConflictException('Assessments with submissions cannot be edited');
      return tx.assessment.update({ where: { id }, data: dto });
    });
  }
  @Get('course/:courseId') async list(@User() u: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string) {
    if (!(await this.courses.canAccess(u, courseId))) throw new ForbiddenException('Course access required');
    const assessments = await this.db.assessment.findMany({ where: { course_id: courseId }, orderBy: { created_at: 'desc' }, include: { submissions: { where: { student_id: u.id }, select: { id: true, answer: true, score: true, feedback: true, reviewed_at: true, submitted_at: true } } } });
    return assessments;
  }
  @Permissions('courses:write') @Get('course/:courseId/submissions') async submissions(@User() u: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string) {
    await this.courses.assertOwner(u, courseId);
    const items = await this.db.assessmentSubmission.findMany({ where: { assessment: { course_id: courseId } }, include: { assessment: { select: { title: true, kind: true, prompt: true, max_score: true } } }, orderBy: { submitted_at: 'desc' } });
    const students = await this.db.user.findMany({ where: { id: { in: items.map(i => i.student_id) } }, select: { id: true, name: true } });
    return items.map(item => ({ ...item, student_name: students.find(s => s.id === item.student_id)?.name ?? 'Student' }));
  }
  @Post(':id/submit') async submit(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AnswerDto) {
    if (u.role !== 'STUDENT') throw new ForbiddenException('Student account required');
    const assessment = await this.db.assessment.findUnique({ where: { id } });
    if (!assessment) throw new NotFoundException('Assessment not found');
    if (!(await this.courses.canAccess(u, assessment.course_id))) throw new ForbiddenException('Course access required');
    try { return await this.db.atomic(async tx => {
      // Read within the serializable transaction so a concurrent edit conflicts with submission.
      const current = await tx.assessment.findUnique({ where: { id }, select: { id: true, questions: true, prompt: true, max_score: true } });
      if (!current) throw new NotFoundException('Assessment not found');
      const questions = current.questions as string[];
      let answer: string;
      if (questions.length) {
        if (dto.expected_max_score !== current.max_score || dto.expected_prompt !== current.prompt || JSON.stringify(dto.expected_questions) !== JSON.stringify(questions)) throw new ConflictException('Assessment changed; reload it before submitting');
        if (!dto.answers || dto.answers.length !== questions.length || dto.answers.some(a => !a.trim())) throw new BadRequestException('Answer every question');
        answer = questions.map((q, i) => `${i + 1}. ${q}\n${dto.answers![i].trim()}`).join('\n\n');
      } else {
        if (!dto.answer?.trim()) throw new BadRequestException('Enter your answer');
        answer = dto.answer.trim();
      }
      return tx.assessmentSubmission.create({ data: { assessment_id: id, student_id: u.id, answer } });
    }); }
    catch (error) { if (await this.db.assessmentSubmission.findUnique({ where: { assessment_id_student_id: { assessment_id: id, student_id: u.id } } })) throw new ConflictException('You have already submitted this assessment'); throw error; }
  }
  @Permissions('courses:write') @Patch('submissions/:id/review') async review(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReviewDto) {
    const submission = await this.db.assessmentSubmission.findUnique({ where: { id }, include: { assessment: true } });
    if (!submission) throw new NotFoundException('Submission not found');
    await this.courses.assertOwner(u, submission.assessment.course_id);
    if (dto.score > submission.assessment.max_score) throw new ConflictException('Score exceeds maximum');
    return this.db.assessmentSubmission.update({ where: { id }, data: { score: dto.score, feedback: dto.feedback, reviewed_at: new Date() } });
  }
}
@Module({ imports: [CoursesModule], controllers: [AssessmentsController] })
export class AssessmentsModule {}
