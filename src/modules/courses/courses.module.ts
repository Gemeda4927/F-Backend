import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  Public,
  Permissions,
  User,
} from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesService } from './courses.service.js';
import { CourseDto } from './courses.dto.js';
@Controller('courses')
class CoursesController {
  constructor(private readonly service: CoursesService) {}
  @Public() @Get() catalog(@Query('search') search?: string) {
    return this.service.catalog(search);
  }
  @Permissions('courses:write') @Get('manage/list') owned(
    @User() u: CurrentUser,
  ) {
    return this.service.owned(u);
  }
  @Permissions('courses:write') @Get('manage/:id/preview') preview(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.preview(u, id);
  }
  @Permissions('courses:write') @Post() create(
    @User() u: CurrentUser,
    @Body() dto: CourseDto,
  ) {
    return this.service.create(u, dto);
  }
  @Permissions('courses:write') @Patch(':id') update(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CourseDto,
  ) {
    return this.service.update(u, id, dto);
  }
  @Permissions('courses:write') @Post(':id/archive') archive(
    @User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string,
  ) { return this.service.archive(u, id, true); }
  @Permissions('courses:write') @Post(':id/restore') restore(
    @User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string,
  ) { return this.service.archive(u, id, false); }
  @Get(':id/access') async access(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { access: await this.service.canAccess(u, id) };
  }
  @Get(':id/learning') learning(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.learningDetails(u, id);
  }
  @Public() @Get(':id') details(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.details(id);
  }
}
@Module({
  controllers: [CoursesController],
  providers: [CoursesService],
  exports: [CoursesService],
})
export class CoursesModule {}
