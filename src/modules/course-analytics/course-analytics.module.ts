import { Module } from '@nestjs/common';
import { CourseAnalyticsController } from './course-analytics.controller.js';
import { CourseAnalyticsService } from './course-analytics.service.js';

@Module({ controllers: [CourseAnalyticsController], providers: [CourseAnalyticsService], exports: [CourseAnalyticsService] })
export class CourseAnalyticsModule {}
