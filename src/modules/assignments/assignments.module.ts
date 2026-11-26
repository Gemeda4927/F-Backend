import { Body, Controller, Delete, Get, Module, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesModule } from '../courses/courses.module.js';
import { AssignmentDto, AssignmentUpdateDto, EvaluationDto } from './assignments.dto.js';
import { AssignmentsService } from './assignments.service.js';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}
  @Permissions('courses:write') @Get('manage/course/:courseId') manage(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string, @Query('kind') kind?: string) { return this.service.manageCourse(user, courseId, kind); }
  @Permissions('courses:write') @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  create(@User() user: CurrentUser, @Body() dto: AssignmentDto, @UploadedFile() file?: Express.Multer.File) { return this.service.create(user, dto, file); }
  @Permissions('courses:write') @Patch(':id') update(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignmentUpdateDto) { return this.service.update(user, id, dto); }
  @Permissions('courses:write') @Post(':id/document') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } })) replace(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) { return this.service.replaceDocument(user, id, file); }
  @Permissions('courses:write') @Post(':id/publish') publish(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body('published') published: boolean) { return this.service.publish(user, id, published); }
  @Permissions('courses:write') @Post(':id/archive') archive(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body('archived') archived: boolean) { return this.service.archive(user, id, archived); }
  @Permissions('courses:write') @Delete(':id') remove(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.remove(user, id); }
  @Get('course/:courseId/tasks') courseTasks(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string) { return this.service.listStudentCourse(user, courseId); }
  @Get('mine') mine(@User() user: CurrentUser) { return this.service.listStudent(user); }
  @Get(':id') details(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.details(user, id); }
  @Throttle({ default: { limit: 60, ttl: 60000 } }) @Get(':id/page/:page') async page(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Param('page', ParseIntPipe) page: number, @Res() response: Response) { const image = await this.service.page(user, id, page); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'"); response.setHeader('X-Content-Type-Options', 'nosniff'); response.type(image.mime_type).send(image.content); }
  @Throttle({ default: { limit: 30, ttl: 60000 } }) @Get(':id/attachment/:attachmentId') async attachment(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Param('attachmentId', ParseUUIDPipe) attachmentId: string, @Res() response: Response) { const file = await this.service.taskAttachment(user, id, attachmentId); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Disposition', `attachment; filename="${file.filename.replace(/"/g, '')}"`); response.setHeader('X-Content-Type-Options', 'nosniff'); response.type(file.mime_type).send(file.content); }
  @Throttle({ default: { limit: 30, ttl: 60000 } }) @Get('submissions/:submissionId/files/:fileId') async submissionFile(@User() user: CurrentUser, @Param('submissionId', ParseUUIDPipe) submissionId: string, @Param('fileId', ParseUUIDPipe) fileId: string, @Query('download') download: string | undefined, @Res() response: Response) { const file = await this.service.submissionFile(user, submissionId, fileId); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="${file.filename.replace(/"/g, '')}"`); response.setHeader('X-Content-Type-Options', 'nosniff'); response.type(file.mime_type).send(file.content); }
  @Permissions('courses:write') @Get(':id/analytics') analytics(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.analytics(user, id); }
  @Get(':id/task') task(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.taskDetails(user, id); }
  @Post(':id/task-attachments')
  @Permissions('courses:write')
  @UseInterceptors(FilesInterceptor('files', 10, { limits: { fileSize: 20 * 1024 * 1024 } }))
  taskAttachments(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFiles() files: Express.Multer.File[]) { return this.service.addTaskAttachments(user, id, files ?? []); }
  @Post(':id/submissions/draft') saveDraft(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body('answer_markdown') answer: string) { return this.service.saveDraft(user, id, answer); }
  @Post(':id/submissions')
  @UseInterceptors(FilesInterceptor('files', 5, { limits: { fileSize: 10 * 1024 * 1024 } }))
  submit(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body('answer_markdown') answer: string, @UploadedFiles() files: Express.Multer.File[]) { return this.service.submitTask(user, id, answer, files ?? []); }
  @Permissions('courses:write') @Get(':id/submissions') submissions(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.listSubmissions(user, id); }
  @Permissions('courses:write') @Patch('submissions/:id/evaluate') evaluate(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EvaluationDto) { return this.service.evaluate(user, id, dto); }
}

@Module({ imports: [CoursesModule], controllers: [AssignmentsController], providers: [AssignmentsService] })
export class AssignmentsModule {}
