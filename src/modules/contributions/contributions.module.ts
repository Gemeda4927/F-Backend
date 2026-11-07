import { Body, ConflictException, Controller, ForbiddenException, Get, Module, NotFoundException, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CoursesService } from '../courses/courses.service.js';
import { audit } from '../audit/audit.js';

class ContributionDto {
  @IsIn(['ANSWER', 'CORRECTION', 'RESOURCE']) kind!: 'ANSWER' | 'CORRECTION' | 'RESOURCE';
  @IsString() @MinLength(3) @MaxLength(10000) content!: string;
}
class RevokeDto { @IsString() @MinLength(10) @MaxLength(1000) reason!: string; }
class CreditConfigDto {
  @IsInt() @Min(0) @Max(1000) answer!: number;
  @IsInt() @Min(0) @Max(1000) correction!: number;
  @IsInt() @Min(0) @Max(1000) resource!: number;
}

@Controller('contributions')
export class ContributionsController {
  constructor(private readonly db: PrismaService, private readonly courses: CoursesService) {}
  @Permissions('roles:manage') @Get('config') async config() {
    return (await this.db.contributionCreditConfig.findUnique({ where: { id: 'default' } })) ?? { id: 'default', answer: 10, correction: 5, resource: 3 };
  }
  @Permissions('roles:manage') @Patch('config') async updateConfig(@User() u: CurrentUser, @Body() dto: CreditConfigDto) {
    return this.db.atomic(async tx => {
      const old = await tx.contributionCreditConfig.findUnique({ where: { id: 'default' } });
      const values = { answer: dto.answer, correction: dto.correction, resource: dto.resource };
      const updated = await tx.contributionCreditConfig.upsert({ where: { id: 'default' }, create: { id: 'default', ...values }, update: values });
      await audit(tx, { actor: u, target: u.id, action: 'CONTRIBUTION_CREDIT_CONFIG_UPDATED', description: 'Contribution credit settings updated.', resourceType: 'CREDIT_CONFIG', oldValues: old ?? { answer: 10, correction: 5, resource: 3 }, newValues: values });
      return updated;
    });
  }
  @Get('me/credits') async credits(@User() u: CurrentUser) {
    const events = await this.db.contributionCreditEvent.findMany({ where: { user_id: u.id }, select: { id: true, amount: true, event: true, created_at: true, contribution: { select: { kind: true } } }, orderBy: { created_at: 'desc' } });
    return { total: events.reduce((sum, event) => sum + event.amount, 0), events };
  }
  @Get('course/:courseId') async list(@User() u: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string) {
    if (!(await this.courses.canAccess(u, courseId))) throw new ForbiddenException('Course access required');
    return this.db.contribution.findMany({ where: { course_id: courseId }, select: { id: true, author_id: true, kind: true, content: true, status: true, created_at: true, author: { select: { name: true } }, _count: { select: { votes: true } }, votes: { where: { user_id: u.id }, select: { user_id: true } } }, orderBy: { created_at: 'desc' }, take: 100 });
  }
  @Post('course/:courseId') async create(@User() u: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string, @Body() dto: ContributionDto) {
    if (u.role !== 'STUDENT') throw new ForbiddenException('Student account required');
    if (!dto.content.trim()) throw new ForbiddenException('Contribution cannot be empty');
    return this.db.atomic(async tx => {
      if (!(await this.courses.canAccess(u, courseId, tx))) throw new ForbiddenException('Course access required');
      return tx.contribution.create({ data: { course_id: courseId, author_id: u.id, kind: dto.kind, content: dto.content.trim() } });
    });
  }
  @Post(':id/upvote') async upvote(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string) {
    if (u.role !== 'STUDENT') throw new ForbiddenException('Student account required');
    try { return await this.db.atomic(async tx => {
      const item = await tx.contribution.findUnique({ where: { id } });
      if (!item) throw new NotFoundException('Contribution not found');
      if (!(await this.courses.canAccess(u, item.course_id, tx))) throw new ForbiddenException('Course access required');
      if (item.author_id === u.id) throw new ForbiddenException('You cannot upvote your own answer');
      if (item.kind !== 'ANSWER' || item.status !== 'VERIFIED') throw new ConflictException('Only verified answers can be upvoted');
      await tx.contributionVote.create({ data: { contribution_id: id, user_id: u.id } });
      return { message: 'Upvote recorded' };
    }); } catch (error) { if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('You have already upvoted this answer'); throw error; }
  }
  @Permissions('courses:write') @Post(':id/verify') async verify(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string) {
    if (u.role !== 'INSTRUCTOR') throw new ForbiddenException('Course instructor required');
    const item = await this.db.contribution.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Contribution not found');
    await this.courses.assertOwner(u, item.course_id);
    return this.db.atomic(async tx => {
      const changed = await tx.contribution.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'VERIFIED', verifier_id: u.id, verified_at: new Date() } });
      if (changed.count !== 1) throw new ConflictException('Contribution is already verified or revoked');
      const config = await tx.contributionCreditConfig.findUnique({ where: { id: 'default' } });
      const amount = item.kind === 'ANSWER' ? (config?.answer ?? 10) : item.kind === 'CORRECTION' ? (config?.correction ?? 5) : (config?.resource ?? 3);
      await tx.contributionCreditEvent.create({ data: { contribution_id: id, user_id: item.author_id, event: 'AWARD', amount } });
      await audit(tx, { actor: u, target: item.author_id, action: 'CONTRIBUTION_VERIFIED', description: 'Contribution verified and credit awarded.', resourceType: 'CONTRIBUTION', resourceId: id, newValues: { amount, kind: item.kind } });
      return { message: 'Contribution verified', credit: amount };
    });
  }
  @Permissions('courses:write') @Post(':id/revoke') async revoke(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RevokeDto) {
    if (u.role !== 'INSTRUCTOR') throw new ForbiddenException('Course instructor required');
    const item = await this.db.contribution.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Contribution not found');
    await this.courses.assertOwner(u, item.course_id);
    return this.db.atomic(async tx => {
      const changed = await tx.contribution.updateMany({ where: { id, status: 'VERIFIED' }, data: { status: 'REVOKED', revoked_at: new Date() } });
      if (changed.count !== 1) throw new ConflictException('Contribution is not currently verified');
      const award = await tx.contributionCreditEvent.findUniqueOrThrow({ where: { contribution_id_event: { contribution_id: id, event: 'AWARD' } } });
      await tx.contributionCreditEvent.create({ data: { contribution_id: id, user_id: item.author_id, event: 'REVERSAL', amount: -award.amount } });
      await audit(tx, { actor: u, target: item.author_id, action: 'CONTRIBUTION_REVOKED', description: 'Contribution verification revoked and credit reversed.', resourceType: 'CONTRIBUTION', resourceId: id, reason: dto.reason, newValues: { amount: -award.amount } });
      return { message: 'Verification revoked', credit: -award.amount };
    });
  }
}
@Module({ imports: [CoursesModule], controllers: [ContributionsController] })
export class ContributionsModule {}
