import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthGuard } from './common/guards/auth.guard.js';
import { OriginGuard } from './common/guards/origin.guard.js';
import { GreetingModule } from './modules/greeting/greeting.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { DevicesModule } from './modules/devices/devices.module.js';
import { CoursesModule } from './modules/courses/courses.module.js';
import { LessonsModule } from './modules/lessons/lessons.module.js';
import { EnrollmentsModule } from './modules/enrollments/enrollments.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { DashboardModule } from './modules/dashboard/dashboard.module.js';
import { StudentsModule } from './modules/students/students.module.js';
import { AssessmentsModule } from './modules/assessments/assessments.module.js';
@Module({
  imports: [
    PrismaModule,
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    GreetingModule,
    HealthModule,
    AuthModule,
    UsersModule,
    DevicesModule,
    CoursesModule,
    LessonsModule,
    EnrollmentsModule,
    PaymentsModule,
    DashboardModule,
    StudentsModule,
    AssessmentsModule,
  ],
  providers: [
    ThrottlerGuard,
    { provide: APP_GUARD, useExisting: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
