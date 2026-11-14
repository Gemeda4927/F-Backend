import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesModule } from '../courses/courses.module.js';
import {
  ChapterDto,
  CreateLessonDto,
  CurriculumDto,
  LessonDraftDto,
  PublishChangesDto,
  PublishCourseDto,
} from './studio.dto.js';
import { StudioService } from './studio.service.js';

/** Authoring endpoints used by Course Studio. Every route is owner/admin scoped. */
@Permissions('courses:write')
@Controller('studio')
class StudioController {
  constructor(private readonly studio: StudioService) {}

  @Get('courses/:courseId/curriculum') curriculum(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.studio.curriculum(u, courseId);
  }
  @Put('courses/:courseId/curriculum') saveCurriculum(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CurriculumDto,
  ) {
    return this.studio.saveCurriculum(u, courseId, dto);
  }
  @Post('courses/:courseId/chapters') createChapter(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: ChapterDto,
  ) {
    return this.studio.createChapter(u, courseId, dto.title);
  }
  @Patch('chapters/:id') renameChapter(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChapterDto,
  ) {
    return this.studio.renameChapter(u, id, dto.title);
  }
  @Delete('chapters/:id') deleteChapter(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studio.deleteChapter(u, id);
  }

  @Post('courses/:courseId/lessons') createLesson(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: CreateLessonDto,
  ) {
    return this.studio.createLesson(u, courseId, dto);
  }
  @Get('lessons/:id') lesson(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studio.lesson(u, id);
  }
  @Patch('lessons/:id/draft') saveDraft(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LessonDraftDto,
  ) {
    return this.studio.saveDraft(u, id, dto);
  }
  @Delete('lessons/:id/draft') discardDraft(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studio.discardDraft(u, id);
  }
  @Post('lessons/:id/duplicate') duplicate(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studio.duplicateLesson(u, id);
  }
  @Delete('lessons/:id') deleteLesson(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.studio.deleteLesson(u, id);
  }

  @Get('courses/:courseId/readiness') readiness(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
  ) {
    return this.studio.readiness(u, courseId);
  }
  @Post('courses/:courseId/publish') publish(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: PublishCourseDto,
  ) {
    return this.studio.publishCourse(u, courseId, dto.published);
  }
  @Post('courses/:courseId/publish-changes') publishChanges(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Body() dto: PublishChangesDto,
  ) {
    return this.studio.publishChanges(u, courseId, dto.lesson_ids);
  }
}

@Module({
  imports: [CoursesModule],
  controllers: [StudioController],
  providers: [StudioService],
})
export class StudioModule {}
