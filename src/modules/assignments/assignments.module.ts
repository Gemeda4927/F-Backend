import { Body, Controller, Delete, Get, Module, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesModule } from '../courses/courses.module.js';
import { AssignmentDto, AssignmentUpdateDto } from './assignments.dto.js';
import { AssignmentsService } from './assignments.service.js';

@Controller('assignments')
export class AssignmentsController {
  constructor(private readonly service: AssignmentsService) {}
  @Permissions('courses:write') @Get('manage/course/:courseId') manage(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string) { return this.service.manageCourse(user, courseId); }
  @Permissions('courses:write') @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  create(@User() user: CurrentUser, @Body() dto: AssignmentDto, @UploadedFile() file?: Express.Multer.File) { return this.service.create(user, dto, file); }
  @Permissions('courses:write') @Patch(':id') update(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignmentUpdateDto) { return this.service.update(user, id, dto); }
  @Permissions('courses:write') @Post(':id/document') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } })) replace(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) { return this.service.replaceDocument(user, id, file); }
  @Permissions('courses:write') @Post(':id/publish') publish(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body('published') published: boolean) { return this.service.publish(user, id, published); }
  @Permissions('courses:write') @Post(':id/archive') archive(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body('archived') archived: boolean) { return this.service.archive(user, id, archived); }
  @Permissions('courses:write') @Delete(':id') remove(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.remove(user, id); }
  @Get('mine') mine(@User() user: CurrentUser) { return this.service.listStudent(user); }
  @Get(':id') details(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.details(user, id); }
  @Throttle({ default: { limit: 60, ttl: 60000 } }) @Get(':id/page/:page') async page(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Param('page', ParseIntPipe) page: number, @Res() response: Response) { const image = await this.service.page(user, id, page); response.setHeader('Cache-Control', 'private, no-store'); response.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'"); response.setHeader('X-Content-Type-Options', 'nosniff'); response.type(image.mime_type).send(image.content); }
  @Permissions('courses:write') @Get(':id/analytics') analytics(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.analytics(user, id); }
}

@Module({ imports: [CoursesModule], controllers: [AssignmentsController], providers: [AssignmentsService] })
export class AssignmentsModule {}
