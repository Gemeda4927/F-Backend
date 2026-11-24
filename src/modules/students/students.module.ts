import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { StudentsService } from './students.service.js';
import { PageDto, StudentAccessDto, StudentProfileDto, StudentReasonDto, StudentStatusDto } from './students.dto.js';
import { AdminRecordsController } from './admin-records.controller.js';

@ApiTags('Super Admin students') @ApiCookieAuth('access_token')
@Permissions('users:manage', 'roles:manage')
@Controller('admin')
export class StudentsController {
  constructor(private readonly students: StudentsService) {}
  @Get('students') @ApiOperation({ summary: 'Search and paginate student accounts' })
  list(@Query() q: PageDto) { return this.students.list(q); }
  @Get('audit-logs') @ApiOperation({ summary: 'Read immutable platform audit history' })
  logs(@Query() q: PageDto) { return this.students.logs(q); }
  @Get('students/:id') @ApiOperation({ summary: 'Inspect authorized student profile and statistics' })
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.students.detail(id); }
  @Patch('students/:id') @ApiOperation({ summary: 'Update permitted profile fields with an audit reason' })
  update(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StudentProfileDto) { return this.students.update(u, id, dto); }
  @Patch('students/:id/status') @ApiOperation({ summary: 'Activate, deactivate, suspend or restore; revoke sessions atomically' })
  status(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StudentStatusDto) { return this.students.status(u, id, dto); }
  @Get('students/:id/courses') @ApiOperation({ summary: 'Paginate enrollments, access and learning progress' })
  courses(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageDto) { return this.students.courses(id, q); }
  @Get('students/:id/progress') @ApiOperation({ summary: 'Paginate course completion summaries' })
  progress(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageDto) { return this.students.courses(id, q); }
  @Get('students/:id/payments') @ApiOperation({ summary: 'Paginate payment history without provider secrets' })
  payments(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageDto) { return this.students.payments(id, q); }
  @Get('students/:id/audit-logs') @ApiOperation({ summary: 'Paginate student audit history' })
  studentLogs(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageDto) { return this.students.logs(q, id); }
  @Post('students/:id/sessions/revoke') @ApiOperation({ summary: 'Revoke all existing sessions' })
  sessions(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StudentReasonDto) { return this.students.revokeSessions(u, id, dto.reason); }
  @Post('students/:id/access') @Permissions('roles:manage', 'access:revoke') @ApiOperation({ summary: 'Explicit audited course access grant or revocation; never changes payments' })
  access(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StudentAccessDto) { return this.students.access(u, id, dto); }
}
@Module({ controllers: [StudentsController, AdminRecordsController], providers: [StudentsService] })
export class StudentsModule {}
