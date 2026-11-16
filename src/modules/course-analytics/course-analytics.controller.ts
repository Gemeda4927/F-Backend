import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { CourseAnalyticsService } from './course-analytics.service.js';

@ApiTags('Course analytics')
@ApiCookieAuth('access_token')
@Controller()
export class CourseAnalyticsController {
  constructor(private readonly analytics: CourseAnalyticsService) {}

  @Post('courses/:id/views')
  @ApiOperation({ summary: 'Record one authenticated student course-overview session' })
  record(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.analytics.recordView(user, id);
  }

  @Get('admin/course-analytics/courses')
  @Permissions('roles:manage')
  list(@User() user: CurrentUser, @Query('search') search?: string) {
    return this.analytics.listCourses(user, search ?? '');
  }

  @Get('admin/course-analytics/courses/:id')
  @Permissions('roles:manage')
  detail(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Query('days') days?: string) {
    return this.analytics.courseAnalytics(user, id, days);
  }

  @Get('admin/course-analytics/courses/:id/viewers')
  @Permissions('roles:manage')
  viewers(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Query() query: { page?: string; pageSize?: string; search?: string; enrolled?: string; sort?: string }) {
    return this.analytics.viewers(user, id, query);
  }

  @Get('admin/course-analytics/courses/:id/viewers/:studentId/history')
  @Permissions('roles:manage')
  history(@User() user: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Param('studentId', ParseUUIDPipe) studentId: string) {
    return this.analytics.history(user, id, studentId);
  }
}
