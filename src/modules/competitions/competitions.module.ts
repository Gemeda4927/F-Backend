import { Body, Controller, Get, Module, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { Permissions, User } from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CompetitionsService } from './competitions.service.js';

@Controller('competitions')
class CompetitionsController {
  constructor(private readonly service: CompetitionsService) {}
  @Get('course/:courseId') overview(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string) { return this.service.overview(user, courseId); }
  @Get('course/:courseId/leaderboard') leaderboard(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string, @Query('period') period: 'all-time' | 'weekly' | 'monthly' = 'all-time', @Query('category') category = 'overall', @Query('page', new ParseIntPipe({ optional: true })) page = 1) { return this.service.leaderboard(user, courseId, ['all-time', 'weekly', 'monthly'].includes(period) ? period : 'all-time', category, Math.max(page, 1)); }
  @Get('course/:courseId/performance') performance(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string) { return this.service.performance(user, courseId); }
  @Patch('course/:courseId/visibility') visibility(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string, @Body() body: { display_name?: string; show_on_board?: boolean; opt_out?: boolean }) { return this.service.visibility(user, courseId, body); }
  @Permissions('courses:write') @Post('course/:courseId/activate') activate(@User() user: CurrentUser, @Param('courseId', ParseUUIDPipe) courseId: string, @Body('title') title?: string) { return this.service.activate(user, courseId, title); }
}

@Module({ imports: [CoursesModule], controllers: [CompetitionsController], providers: [CompetitionsService] })
export class CompetitionsModule {}
