import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { seedConfiguration } from '../prisma/seed.js';
import { ChapaGateway } from '../src/modules/payments/chapa.gateway.js';
import { MailService } from '../src/modules/auth/mail.service.js';
import { StudentsService } from '../src/modules/students/students.service.js';
import { DatabaseFilter } from '../src/common/filters/database.filter.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
describe.runIf(enabled)('PostgreSQL security integration', () => {
  let app: INestApplication, db: PrismaService;
  let refundPaymentRef = '',
    refundProviderCalls = 0;
  const origin = 'http://localhost:3000',
    password = 'Correct-horse-long-77';
  const agents: Record<string, ReturnType<typeof request.agent>> = {};
  const ids: Record<string, string> = {};
  let courseId = '',
    lessonId = '',
    paymentRef = '',
    paymentId = '',
    recoveryToken = '',
    gatewayAmount = '125.00';
  const call = (
    agent: ReturnType<typeof request.agent>,
    method: 'get' | 'post' | 'patch',
    path: string,
  ) => agent[method]('/api/v1' + path).set('Origin', origin);
  beforeAll(async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.PRIVATE_STORAGE_DIR = '.test-postgres/materials';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-01234567890123456789';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-01234567890123456789';
    process.env.FRONTEND_URL = origin;
    process.env.BACKEND_URL = 'http://localhost:5000';
    process.env.COOKIE_SECURE = 'false';
    process.env.CHAPA_MODE = 'test';
    const gateway = {
      refund: vi.fn(async () => {
        refundProviderCalls++;
        return { ref_id: 'refund-provider-test' };
      }),
      verifyRefund: vi.fn(async () => ({
        amount: '125.00',
        currency: 'ETB',
        ref_id: 'refund-provider-test',
        payment_reference: 'chapa-' + refundPaymentRef,
        status: 'refunded',
      })),
      initialize: vi.fn(async () => ({
        checkout_url: 'https://checkout.chapa.co/test-only',
      })),
      verify: vi.fn(async (reference: string) => ({
        tx_ref: reference,
        amount: gatewayAmount,
        currency: 'ETB',
        email: 'student@freshman.test',
        status: 'success',
        reference: 'chapa-' + reference,
        mode: 'test',
      })),
    };
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .overrideProvider(ChapaGateway)
      .useValue(gateway)
      .overrideProvider(MailService)
      .useValue({
        requireConfiguration: () => {},
        sendReset: async (_email: string, token: string) => {
          recoveryToken = token;
        },
      })
      .compile();
    app = module.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new DatabaseFilter());
    await app.init();
    db = module.get(PrismaService);
    const [database] = [
      { name: new URL(process.env.TEST_DATABASE_URL!).pathname.slice(1) },
    ];
    if (database.name !== 'freshman_test_platform')
      throw Error(
        'Integration tests require the isolated freshman_test_platform database',
      );
    const host = new URL(process.env.TEST_DATABASE_URL!).hostname;
    if (
      !['127.0.0.1', 'localhost', '[::1]'].includes(host) &&
      process.env.TEST_DATABASE_ALLOW_REMOTE !== 'true'
    )
      throw Error(
        'Refusing to clear a non-local test database without TEST_DATABASE_ALLOW_REMOTE=true',
      );
    await db.$transaction([
      db.contributionCreditEvent.deleteMany(),
      db.contributionVote.deleteMany(),
      db.contribution.deleteMany(),
      db.contributionCreditConfig.deleteMany(),
      db.assessmentSubmission.deleteMany(),
      db.assessment.deleteMany(),
      db.refund.deleteMany(),
      db.auditLog.deleteMany(),
      db.learningProgress.deleteMany(),
      db.courseEntitlement.deleteMany(),
      db.enrollment.deleteMany(),
      db.payment.deleteMany(),
      db.lesson.deleteMany(),
      db.course.deleteMany(),
      db.passwordResetToken.deleteMany(),
      db.authSession.deleteMany(),
      db.studentDevice.deleteMany(),
      db.user.deleteMany(),
    ]);
    await seedConfiguration(db);
    const hash = await bcrypt.hash(password, 4);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'INSTRUCTOR', 'STUDENT']) {
      ids[role] = randomUUID();
      await db.user.create({
        data: {
          id: ids[role],
          email: role.toLowerCase() + '@freshman.test',
          name: 'Test ' + role,
          password_hash: hash,
          role: role,
          role_id: role,
        },
      });
      agents[role] = request.agent(app.getHttpServer());
      await call(agents[role], 'post', '/auth/login')
        .send({ email: role.toLowerCase() + '@freshman.test', password })
        .expect(200);
    }
  }, 60000);
  afterAll(async () => {
    await app?.close();
  });
  it('public registration cannot assign an elevated role', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({
        name: 'Bad actor',
        email: 'new@freshman.test',
        password,
        role: 'SUPER_ADMIN',
      })
      .expect(400);
  });
  it('registration creates a student with HTTP-only session cookies', async () => {
    const r = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ name: 'New student', email: 'new@freshman.test', password })
      .expect(201);
    expect(r.body.role).toBe('STUDENT');
    expect(r.body.access).toBeUndefined();
    expect(
      (r.headers['set-cookie'] as unknown as string[]).every((c: string) =>
        c.includes('HttpOnly'),
      ),
    ).toBe(true);
  });
  it('enforces granular permissions for all four roles', async () => {
    await call(agents.STUDENT, 'get', '/users').expect(403);
    await call(agents.INSTRUCTOR, 'get', '/users').expect(403);
    await call(agents.ADMIN, 'get', '/users').expect(200);
    await call(agents.SUPER_ADMIN, 'get', '/users').expect(200);
    await call(agents.ADMIN, 'patch', '/users/' + ids.STUDENT)
      .send({ role: 'ADMIN' })
      .expect(403);
  });
  it('returns real role-specific dashboard summaries', async () => {
    for (const role of Object.keys(agents)) {
      const r = await call(agents[role], 'get', '/dashboard').expect(200);
      expect(r.body.role).toBe(role);
      expect(typeof r.body.metrics.courses).toBe('number');
    }
  });
  it('blocks a second registered client and keeps registration after logout', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'student@freshman.test', password })
      .expect(409);
    await call(agents.STUDENT, 'post', '/auth/logout').expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'student@freshman.test', password })
      .expect(409);
    await call(agents.STUDENT, 'post', '/auth/login')
      .send({ email: 'student@freshman.test', password })
      .expect(200);
  });
  it('atomically allows only one simultaneous first-device login', async () => {
    await db.user.create({
      data: {
        id: randomUUID(),
        email: 'race@freshman.test',
        name: 'Race student',
        password_hash: await bcrypt.hash(password, 4),
        role_id: 'STUDENT',
      },
    });
    const login = () =>
      request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: 'race@freshman.test', password });
    const results = await Promise.all([login(), login()]);
    expect(results.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      200, 409,
    ]);
    expect(
      [
        {
          count: await db.studentDevice.count({
            where: { user: { email: 'race@freshman.test' }, revoked_at: null },
          }),
        },
      ][0].count,
    ).toBe(1);
  });
  it('rotates refresh sessions and rejects replayed refresh tokens', async () => {
    const agent = request.agent(app.getHttpServer());
    const login = await call(agent, 'post', '/auth/login')
      .send({ email: 'admin@freshman.test', password })
      .expect(200);
    const old = (login.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('refresh_token='))!
      .split(';')[0];
    await call(agent, 'post', '/auth/refresh').expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Origin', origin)
      .set('Cookie', old)
      .expect(401);
    await call(agent, 'get', '/auth/me').expect(401);
    await call(agents.ADMIN, 'post', '/auth/login')
      .send({ email: 'admin@freshman.test', password })
      .expect(200);
  });
  it('creates a paid course and protects instructor ownership', async () => {
    const r = await call(agents.INSTRUCTOR, 'post', '/courses')
      .send({
        title: 'Database foundations',
        description: 'A comprehensive introduction to relational databases.',
        category: 'Engineering',
        price_minor: 12500,
        currency: 'ETB',
        published: true,
        visibility: 'PUBLIC',
      })
      .expect(201);
    courseId = r.body.id;
    const l = await call(
      agents.INSTRUCTOR,
      'post',
      '/lessons/course/' + courseId,
    )
      .send({
        title: 'Protected lesson',
        position: 0,
        kind: 'TEXT',
        preview: false,
        content: 'Paid material only.',
      })
      .expect(201);
    lessonId = l.body.id;
    const otherId = randomUUID();
    await db.user.create({
      data: {
        id: otherId,
        email: 'other@freshman.test',
        name: 'Other instructor',
        password_hash: await bcrypt.hash(password, 4),
        role: 'INSTRUCTOR',
        role_id: 'INSTRUCTOR',
      },
    });
    const other = request.agent(app.getHttpServer());
    await call(other, 'post', '/auth/login')
      .send({ email: 'other@freshman.test', password })
      .expect(200);
    await call(other, 'post', '/lessons/course/' + courseId)
      .send({
        title: 'Unauthorized lesson',
        position: 1,
        kind: 'TEXT',
        preview: false,
        content: 'No',
      })
      .expect(403);
  });
  it('exposes only explicitly public published courses in discovery', async () => {
    const make = (
      title: string,
      visibility: 'PRIVATE' | 'UNLISTED' | 'PUBLIC',
      published = true,
      archived_at: Date | null = null,
    ) =>
      db.course.create({
        data: {
          title,
          description: 'Visibility test course description',
          instructor_id: ids.INSTRUCTOR,
          price_minor: 0,
          published,
          visibility,
          archived_at,
          lessons: {
            create: {
              title: 'Restricted preview',
              position: 0,
              kind: 'TEXT',
              preview: true,
              content: 'private material',
            },
          },
        },
        include: { lessons: true },
      });
    const privateCourse = await make('Private course', 'PRIVATE');
    const unlisted = await make('Unlisted course', 'UNLISTED');
    const draft = await make('Draft course', 'PUBLIC', false);
    const archived = await make('Archived course', 'PUBLIC', true, new Date());
    const catalog = await request(app.getHttpServer())
      .get('/api/v1/courses')
      .expect(200);
    const index = await request(app.getHttpServer())
      .get('/api/v1/courses/indexable')
      .expect(200);
    for (const course of [privateCourse, unlisted, draft, archived]) {
      expect(
        catalog.body.some((item: { id: string }) => item.id === course.id),
      ).toBe(false);
      expect(
        index.body.some((item: { id: string }) => item.id === course.id),
      ).toBe(false);
      await request(app.getHttpServer())
        .get('/api/v1/courses/' + course.id)
        .expect(404);
      await request(app.getHttpServer())
        .get('/api/v1/lessons/' + course.lessons[0].id + '/preview')
        .expect(403);
      await call(
        agents.STUDENT,
        'get',
        '/courses/' + course.id + '/learning',
      ).expect(403);
      await call(
        agents.STUDENT,
        'get',
        '/assessments/course/' + course.id,
      ).expect(403);
      await call(
        agents.STUDENT,
        'post',
        '/enrollments/' + course.id + '/free',
      ).expect(403);
    }
    expect(
      catalog.body.some((item: { id: string }) => item.id === courseId),
    ).toBe(true);
    expect(
      index.body.some((item: { id: string }) => item.id === courseId),
    ).toBe(true);
    await request(app.getHttpServer())
      .get('/api/v1/courses/' + courseId)
      .expect(200);
    const thumbnailPath = '/courses/manage/' + privateCourse.id + '/thumbnail';
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aX8AAAAASUVORK5CYII=',
      'base64',
    );
    await call(agents.STUDENT, 'post', thumbnailPath)
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(403);
    await call(agents.INSTRUCTOR, 'post', thumbnailPath)
      .attach('file', Buffer.from('not an image'), {
        filename: 'bad.png',
        contentType: 'image/png',
      })
      .expect(400);
    await call(agents.INSTRUCTOR, 'post', thumbnailPath)
      .attach('file', png, { filename: 'image.png', contentType: 'image/png' })
      .expect(201);
    await call(agents.INSTRUCTOR, 'post', thumbnailPath)
      .attach('file', png, {
        filename: 'replacement.png',
        contentType: 'image/png',
      })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/courses/' + privateCourse.id + '/thumbnail')
      .expect(404);
    await call(agents.STUDENT, 'get', thumbnailPath).expect(404);
    await call(agents.INSTRUCTOR, 'get', thumbnailPath)
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('Cache-Control', /no-store/);
    await db.course.update({
      where: { id: privateCourse.id },
      data: { visibility: 'PUBLIC' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/courses/' + privateCourse.id + '/thumbnail')
      .expect(200)
      .expect('Cache-Control', /no-store/);
    await db.course.update({
      where: { id: privateCourse.id },
      data: { visibility: 'PRIVATE' },
    });
    await request(app.getHttpServer())
      .get('/api/v1/courses/' + privateCourse.id + '/thumbnail')
      .expect(404);
    await agents.INSTRUCTOR.delete('/api/v1' + thumbnailPath)
      .set('Origin', origin)
      .expect(200);
    await call(agents.INSTRUCTOR, 'get', thumbnailPath).expect(404);
  });
  it('blocks unpaid lesson content and private asset access', async () => {
    await call(agents.STUDENT, 'get', '/lessons/' + lessonId).expect(403);
    await call(agents.STUDENT, 'get', '/lessons/' + lessonId + '/file').expect(
      403,
    );
    await call(
      agents.STUDENT,
      'post',
      '/enrollments/' + courseId + '/free',
    ).expect(403);
    const access = await call(
      agents.STUDENT,
      'get',
      '/courses/' + courseId + '/access',
    ).expect(200);
    expect(access.body.access).toBe(false);
  });
  it('creates idempotent server-priced checkout without granting access', async () => {
    const key = randomUUID(),
      payload = { course_id: courseId, idempotency_key: key };
    const r = await call(agents.STUDENT, 'post', '/payments')
      .send(payload)
      .expect(201);
    paymentRef = r.body.tx_ref;
    paymentId = r.body.id;
    const retry = await call(agents.STUDENT, 'post', '/payments')
      .send(payload)
      .expect(201);
    expect(retry.body.id).toBe(paymentId);
    expect(r.body.amount_minor).toBe(12500);
    await call(agents.STUDENT, 'post', '/payments')
      .send({ ...payload, amount_minor: 1 })
      .expect(400);
    await call(agents.STUDENT, 'get', '/lessons/' + lessonId).expect(403);
  });
  it('rejects forged webhooks and mismatched provider amounts', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhook')
      .send({ tx_ref: paymentRef, status: 'success' })
      .expect(401);
    gatewayAmount = '0.01';
    await call(agents.STUDENT, 'get', '/payments/status/' + paymentRef).expect(
      502,
    );
    expect(
      [
        await db.payment.findUniqueOrThrow({
          where: { id: paymentId },
          select: { status: true },
        }),
      ][0].status,
    ).toBe('PENDING');
    gatewayAmount = '125.00';
  });
  it('grants access exactly once after server verification', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/payments/callback?tx_ref=' + paymentRef)
      .expect(200);
    expect(
      await db.auditLog.count({
        where: {
          target_id: ids.STUDENT,
          action: 'PAYMENT_VERIFIED',
          resource_id: paymentId,
        },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: {
          target_id: ids.STUDENT,
          action: 'COURSE_ENROLLED',
          resource_id: courseId,
        },
      }),
    ).toBe(1);
    await request(app.getHttpServer())
      .get('/api/v1/payments/callback?tx_ref=' + paymentRef)
      .expect(200);
    expect(
      [
        {
          n: await db.enrollment.count({
            where: { user_id: ids.STUDENT, course_id: courseId },
          }),
        },
      ][0].n,
    ).toBe(1);
    const lesson = await call(
      agents.STUDENT,
      'get',
      '/lessons/' + lessonId,
    ).expect(200);
    expect(lesson.body.content).toBe('Paid material only.');
    await call(
      agents.STUDENT,
      'post',
      '/lessons/' + lessonId + '/complete',
    ).expect(201);
    expect(
      (
        await call(
          agents.STUDENT,
          'get',
          '/lessons/course/' + courseId + '/progress',
        ).expect(200)
      ).body,
    ).toHaveLength(1);
  });

  it('awards and reverses contribution credits once and prevents self or duplicate upvotes', async () => {
    const voterId = randomUUID();
    await db.user.create({
      data: {
        id: voterId,
        email: 'voter@freshman.test',
        name: 'Voter',
        role: 'STUDENT',
        role_id: 'STUDENT',
        password_hash: await bcrypt.hash(password, 4),
      },
    });
    await db.enrollment.create({
      data: {
        user_id: voterId,
        course_id: courseId,
        entitlement: { create: {} },
      },
    });
    const voter = request.agent(app.getHttpServer());
    await call(voter, 'post', '/auth/login')
      .send({ email: 'voter@freshman.test', password })
      .expect(200);
    const item = await call(
      agents.STUDENT,
      'post',
      '/contributions/course/' + courseId,
    )
      .send({ kind: 'ANSWER', content: 'A verified answer.' })
      .expect(201);
    const id = item.body.id;
    await call(
      agents.STUDENT,
      'post',
      '/contributions/' + id + '/verify',
    ).expect(403);
    const other = request.agent(app.getHttpServer());
    await call(other, 'post', '/auth/login')
      .send({ email: 'other@freshman.test', password })
      .expect(200);
    await call(other, 'post', '/contributions/' + id + '/verify').expect(403);
    const attempts = await Promise.all([
      call(agents.INSTRUCTOR, 'post', '/contributions/' + id + '/verify'),
      call(agents.INSTRUCTOR, 'post', '/contributions/' + id + '/verify'),
    ]);
    expect(attempts.map((r) => r.status).sort((a, b) => a - b)).toEqual([
      201, 409,
    ]);
    expect(
      (
        await call(agents.STUDENT, 'get', '/contributions/me/credits').expect(
          200,
        )
      ).body.total,
    ).toBe(10);
    await call(
      agents.STUDENT,
      'post',
      '/contributions/' + id + '/upvote',
    ).expect(403);
    await call(voter, 'post', '/contributions/' + id + '/upvote').expect(201);
    await call(voter, 'post', '/contributions/' + id + '/upvote').expect(409);
    expect(
      (await call(voter, 'get', '/contributions/me/credits').expect(200)).body
        .total,
    ).toBe(0);
    await call(agents.INSTRUCTOR, 'post', '/contributions/' + id + '/revoke')
      .send({ reason: 'Answer is no longer valid' })
      .expect(201);
    await call(agents.INSTRUCTOR, 'post', '/contributions/' + id + '/revoke')
      .send({ reason: 'Answer is no longer valid' })
      .expect(409);
    expect(
      (
        await call(agents.STUDENT, 'get', '/contributions/me/credits').expect(
          200,
        )
      ).body.total,
    ).toBe(0);
    expect(
      await db.contributionCreditEvent.count({
        where: { contribution_id: id },
      }),
    ).toBe(2);
    expect(
      await db.auditLog.count({
        where: {
          resource_id: id,
          action: { in: ['CONTRIBUTION_VERIFIED', 'CONTRIBUTION_REVOKED'] },
        },
      }),
    ).toBe(2);
    await call(agents.ADMIN, 'patch', '/contributions/config')
      .send({ answer: 10, correction: 8, resource: 3 })
      .expect(403);
    await call(agents.SUPER_ADMIN, 'patch', '/contributions/config')
      .send({ answer: 10, correction: 8, resource: 3 })
      .expect(200);
    const correction = await call(
      agents.STUDENT,
      'post',
      '/contributions/course/' + courseId,
    )
      .send({ kind: 'CORRECTION', content: 'An approved correction.' })
      .expect(201);
    expect(
      (
        await call(
          agents.INSTRUCTOR,
          'post',
          '/contributions/' + correction.body.id + '/verify',
        ).expect(201)
      ).body.credit,
    ).toBe(8);
    await call(agents.SUPER_ADMIN, 'patch', '/contributions/config')
      .send({ answer: 10, correction: 5, resource: 3 })
      .expect(200);
  });
  it('hides quiz answers and grades submissions on the backend', async () => {
    const result = await call(
      agents.INSTRUCTOR,
      'post',
      '/lessons/course/' + courseId,
    )
      .send({
        title: 'Check your understanding',
        position: 1,
        kind: 'QUIZ',
        preview: false,
        content: 'Choose the best answer.',
        quiz: [
          {
            question: 'Which key identifies a row?',
            options: ['Primary key', 'CSS class'],
            correctIndex: 0,
          },
        ],
      })
      .expect(201);
    const id = result.body.id;
    const lesson = await call(agents.STUDENT, 'get', '/lessons/' + id).expect(
      200,
    );
    expect(lesson.body.quiz[0].correctIndex).toBeUndefined();
    const failed = await call(
      agents.STUDENT,
      'post',
      '/lessons/' + id + '/quiz',
    )
      .send({ answers: [1] })
      .expect(201);
    expect(failed.body.passed).toBe(false);
    const passed = await call(
      agents.STUDENT,
      'post',
      '/lessons/' + id + '/quiz',
    )
      .send({ answers: [0] })
      .expect(201);
    expect(passed.body.passed).toBe(true);
  });
  it('keeps uploaded PDF material private and enforces ownership', async () => {
    const result = await call(
      agents.INSTRUCTOR,
      'post',
      '/lessons/course/' + courseId,
    )
      .send({
        title: 'Protected workbook',
        position: 2,
        kind: 'PDF',
        preview: false,
        content: 'Read the workbook.',
      })
      .expect(201);
    const id = result.body.id;
    await agents.INSTRUCTOR.post('/api/v1/lessons/' + id + '/asset')
      .set('Origin', origin)
      .attach('file', Buffer.from('%PDF-1.4\nTest learning material\n%%EOF'), {
        filename: 'workbook.pdf',
        contentType: 'application/pdf',
      })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/v1/lessons/' + id + '/file')
      .expect(401);
    const file = await call(
      agents.STUDENT,
      'get',
      '/lessons/' + id + '/file',
    ).expect(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(file.headers['cache-control']).toContain('no-store');
    await call(
      agents.INSTRUCTOR,
      'get',
      '/lessons/course/' + courseId + '/manage',
    ).expect(200);
    await call(
      agents.STUDENT,
      'get',
      '/lessons/course/' + courseId + '/manage',
    ).expect(403);
  });
  it('admin device reset revokes old sessions without losing purchases', async () => {
    await call(
      agents.STUDENT,
      'post',
      '/devices/student/' + ids.STUDENT + '/reset',
    )
      .send({ reason: 'Malicious reset' })
      .expect(403);
    await call(
      agents.ADMIN,
      'post',
      '/devices/student/' + ids.STUDENT + '/reset',
    )
      .send({ reason: 'Verified identity recovery' })
      .expect(201);
    await call(agents.STUDENT, 'get', '/auth/me').expect(401);
    agents.STUDENT = request.agent(app.getHttpServer());
    await call(agents.STUDENT, 'post', '/auth/login')
      .send({ email: 'student@freshman.test', password })
      .expect(200);
    await call(agents.STUDENT, 'get', '/lessons/' + lessonId).expect(200);
  });
  it('password recovery is one-time and revokes all old device sessions', async () => {
    await call(agents.STUDENT, 'post', '/auth/forgot-password')
      .send({ email: 'student@freshman.test' })
      .expect(201);
    expect(recoveryToken).toHaveLength(64);
    const nextPassword = 'A-new-password-12345';
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', origin)
      .send({ token: recoveryToken, password: nextPassword })
      .expect(201);
    await call(agents.STUDENT, 'get', '/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .set('Origin', origin)
      .send({ token: recoveryToken, password: nextPassword })
      .expect(400);
    agents.STUDENT = request.agent(app.getHttpServer());
    await call(agents.STUDENT, 'post', '/auth/login')
      .send({ email: 'student@freshman.test', password: nextPassword })
      .expect(200);
    await call(agents.STUDENT, 'get', '/lessons/' + lessonId).expect(200);
  });
  it('revoked access stays revoked despite replayed successful callbacks', async () => {
    await call(agents.ADMIN, 'post', '/payments/' + paymentId + '/revoke')
      .send({ reason: 'Confirmed refund issued by provider' })
      .expect(201);
    await call(agents.STUDENT, 'get', '/lessons/' + lessonId).expect(403);
    await request(app.getHttpServer())
      .get('/api/v1/payments/callback?tx_ref=' + paymentRef)
      .expect(200);
    expect(
      (
        await db.enrollment.findMany({
          where: { payment_id: paymentId },
          select: { status: true },
        })
      )[0].status,
    ).toBe('REVOKED');
  });
  it('rejects cookie mutations from untrusted origins', async () => {
    await agents.ADMIN.post('/api/v1/auth/profile')
      .set('Origin', 'https://untrusted.example')
      .send({ name: 'Changed' })
      .expect(403);
  });

  it('requests one full refund and verifies it before recording refunded status', async () => {
    const course = await call(agents.INSTRUCTOR, 'post', '/courses')
      .send({
        title: 'Refund test course',
        description: 'A course used to verify payment refund safety.',
        category: 'Engineering',
        price_minor: 12500,
        currency: 'ETB',
        published: true,
        visibility: 'PUBLIC',
      })
      .expect(201);
    const payment = await call(agents.STUDENT, 'post', '/payments')
      .send({ course_id: course.body.id, idempotency_key: randomUUID() })
      .expect(201);
    refundPaymentRef = payment.body.tx_ref;
    await request(app.getHttpServer())
      .get('/api/v1/payments/callback?tx_ref=' + refundPaymentRef)
      .expect(200);
    await call(
      agents.STUDENT,
      'post',
      '/payments/' + payment.body.id + '/refund',
    )
      .send({ reason: 'Not permitted' })
      .expect(403);
    const refunded = await call(
      agents.ADMIN,
      'post',
      '/payments/' + payment.body.id + '/refund',
    )
      .send({ reason: 'Approved student cancellation' })
      .expect(201);
    expect(refunded.body.status).toBe('PROCESSING');
    const verify = await call(
      agents.ADMIN,
      'get',
      '/payments/' + payment.body.id + '/refund',
    ).expect(200);
    expect(verify.body.status).toBe('REFUNDED');
    await call(agents.ADMIN, 'post', '/payments/' + payment.body.id + '/refund')
      .send({ reason: 'Duplicate request ignored' })
      .expect(201);
    expect(refundProviderCalls).toBe(1);
    expect(
      [
        await db.payment.findUniqueOrThrow({
          where: { id: payment.body.id },
          select: { status: true },
        }),
      ][0].status,
    ).toBe('REFUNDED');
    const access = await call(
      agents.STUDENT,
      'get',
      '/courses/' + course.body.id + '/access',
    ).expect(200);
    expect(access.body.access).toBe(false);
  });

  it('preserves users, purchases and revoked entitlements across repeated safe seeding', async () => {
    const snapshot = async () => ({
      users: await db.user.findMany({ orderBy: { id: 'asc' } }),
      payments: await db.payment.findMany({ orderBy: { id: 'asc' } }),
      enrollments: await db.enrollment.findMany({ orderBy: { id: 'asc' } }),
      entitlements: await db.courseEntitlement.findMany({
        orderBy: { id: 'asc' },
      }),
      devices: await db.studentDevice.findMany({ orderBy: { id: 'asc' } }),
    });
    const before = await snapshot();
    await seedConfiguration(db);
    await seedConfiguration(db);
    expect(await snapshot()).toEqual(before);
  });
  it('checks granular permissions from PostgreSQL rather than a hardcoded role grant', async () => {
    await db.rolePermission.delete({
      where: {
        role_id_permission_code: {
          role_id: 'ADMIN',
          permission_code: 'devices:reset',
        },
      },
    });
    try {
      await call(
        agents.ADMIN,
        'post',
        '/devices/student/' + ids.STUDENT + '/reset',
      )
        .send({ reason: 'Denied after permission removal' })
        .expect(403);
    } finally {
      await db.rolePermission.create({
        data: { role_id: 'ADMIN', permission_code: 'devices:reset' },
      });
    }
  });
  describe('Super Admin student administration', () => {
    let studentId = '',
      managedCourse = '';
    it('restricts dedicated student APIs to Super Admin permissions', async () => {
      for (const role of ['STUDENT', 'INSTRUCTOR', 'ADMIN']) {
        await call(agents[role], 'get', '/admin/students').expect(403);
        await call(agents[role], 'get', '/admin/audit-logs').expect(403);
      }
      await call(agents.SUPER_ADMIN, 'get', '/admin/students').expect(200);
    });
    it('paginates and searches actual students without leaking credentials', async () => {
      const user = await db.user.create({
        data: {
          name: 'Managed Student',
          email: 'managed@freshman.test',
          role: 'STUDENT',
          role_id: 'STUDENT',
          password_hash: await bcrypt.hash(password, 4),
        },
      });
      studentId = user.id;
      const result = await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students?search=managed&pageSize=1&sort=name&direction=asc',
      ).expect(200);
      expect(result.body.total).toBe(1);
      expect(result.body.items[0].id).toBe(studentId);
      expect(result.body.items[0].status).toBe('ACTIVE');
      expect(JSON.stringify(result.body)).not.toMatch(
        /password_hash|token_hash|refresh_hash/,
      );
      await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students?pageSize=101',
      ).expect(400);
      await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students?sort=password_hash',
      ).expect(400);
      await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students/not-a-uuid',
      ).expect(400);
      await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students/' + ids.INSTRUCTOR,
      ).expect(404);
    });
    it('validates profile updates and records safe chronological field changes', async () => {
      await call(agents.SUPER_ADMIN, 'patch', '/admin/students/' + studentId)
        .send({
          name: 'Updated student',
          reason: 'Verified profile correction',
          actor_id: ids.ADMIN,
        })
        .expect(400);
      await call(agents.SUPER_ADMIN, 'patch', '/admin/students/' + studentId)
        .send({
          name: 'Updated student',
          phone: '+251 123 456',
          reason: 'Verified profile correction password=never-save',
        })
        .expect(200);
      const history = await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students/' +
          studentId +
          '/audit-logs?action=PROFILE_UPDATED&pageSize=1',
      ).expect(200);
      expect(history.body.total).toBe(1);
      expect(history.body.items[0].actor_id).toBe(ids.SUPER_ADMIN);
      expect(history.body.items[0].old_values.name).toBe('Managed Student');
      expect(history.body.items[0].new_values.name).toBe('Updated student');
      expect(history.body.items[0].new_values.phone).toBe('[redacted]');
      expect(history.body.items[0].actor_role).toBe('SUPER_ADMIN');
      expect(JSON.stringify(history.body)).not.toContain('never-save');
    });
    it('suspends, restores and invalidates existing student sessions', async () => {
      const student = request.agent(app.getHttpServer());
      await call(student, 'post', '/auth/login')
        .send({ email: 'managed@freshman.test', password })
        .expect(200);
      await call(
        agents.SUPER_ADMIN,
        'patch',
        '/admin/students/' + studentId + '/status',
      )
        .send({ status: 'SUSPENDED' })
        .expect(400);
      await call(
        agents.SUPER_ADMIN,
        'patch',
        '/admin/students/' + studentId + '/status',
      )
        .send({
          status: 'SUSPENDED',
          reason: 'Confirmed account policy violation',
        })
        .expect(200);
      await call(student, 'get', '/auth/me').expect(401);
      const filtered = await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students?status=SUSPENDED&search=managed',
      ).expect(200);
      expect(filtered.body.total).toBe(1);
      await call(
        agents.SUPER_ADMIN,
        'patch',
        '/admin/students/' + studentId + '/status',
      )
        .send({
          status: 'ACTIVE',
          reason: 'Account review completed successfully',
        })
        .expect(200);
      await call(student, 'post', '/auth/login')
        .send({ email: 'managed@freshman.test', password })
        .expect(200);
      await call(
        agents.SUPER_ADMIN,
        'post',
        '/admin/students/' + studentId + '/sessions/revoke',
      )
        .send({ reason: 'Verified session security review' })
        .expect(201);
      await call(student, 'get', '/auth/me').expect(401);
      expect(
        await db.studentDevice.count({
          where: { user_id: studentId, revoked_at: null },
        }),
      ).toBe(1);
      await call(
        agents.SUPER_ADMIN,
        'post',
        '/admin/students/' + studentId + '/devices/reset',
      )
        .send({ reason: 'Student replacing registered browser' })
        .expect(201);
      expect(
        await db.studentDevice.count({
          where: { user_id: studentId, revoked_at: null },
        }),
      ).toBe(0);
    });
    it('grants and revokes explicit access without inventing or changing payments', async () => {
      const student = request.agent(app.getHttpServer());
      const course = await db.course.create({
        data: {
          title: 'Administrative access course',
          description: 'Test explicit entitlement workflow',
          instructor_id: ids.INSTRUCTOR,
          price_minor: 99900,
          published: true,
        },
      });
      managedCourse = course.id;
      const payments = await db.payment.count({
        where: { user_id: studentId },
      });
      const draft = await db.course.create({
        data: {
          title: 'Unpublished course',
          description: 'Not yet available for learning',
          instructor_id: ids.INSTRUCTOR,
          price_minor: 0,
          published: false,
        },
      });
      await call(
        agents.SUPER_ADMIN,
        'post',
        '/admin/students/' + studentId + '/access',
      )
        .send({
          course_id: draft.id,
          operation: 'GRANT',
          reason: 'Approved administrative access grant',
        })
        .expect(409);
      await call(
        agents.SUPER_ADMIN,
        'post',
        '/admin/students/' + studentId + '/access',
      )
        .send({
          course_id: managedCourse,
          operation: 'GRANT',
          reason: 'Approved scholarship access grant',
        })
        .expect(201);
      await call(student, 'post', '/auth/login')
        .send({ email: 'managed@freshman.test', password })
        .expect(200);
      await call(
        student,
        'get',
        '/courses/' + managedCourse + '/learning',
      ).expect(200);
      await call(student, 'get', '/assessments/course/' + managedCourse).expect(
        200,
      );
      const records = await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students/' + studentId + '/courses',
      ).expect(200);
      expect(records.body.items[0].access).toBe(true);
      expect(records.body.items[0].payment_id).toBeNull();
      expect(await db.payment.count({ where: { user_id: studentId } })).toBe(
        payments,
      );
      await call(
        agents.SUPER_ADMIN,
        'post',
        '/admin/students/' + studentId + '/access',
      )
        .send({
          course_id: managedCourse,
          operation: 'REVOKE',
          reason: 'Scholarship access period has ended',
        })
        .expect(201);
      const revoked = await call(
        agents.SUPER_ADMIN,
        'get',
        '/admin/students/' + studentId + '/progress',
      ).expect(200);
      expect(revoked.body.items[0].access).toBe(false);
    });
    it('does not commit status when the corresponding audit insert fails', async () => {
      const service = app.get(StudentsService);
      await expect(
        service.status(
          {
            id: randomUUID(),
            name: 'Invalid actor',
            email: 'invalid@freshman.test',
            role: 'SUPER_ADMIN',
            sessionId: randomUUID(),
          },
          studentId,
          { status: 'SUSPENDED', reason: 'Rollback verification only' },
        ),
      ).rejects.toThrow();
      expect(
        (await db.user.findUniqueOrThrow({ where: { id: studentId } })).active,
      ).toBe(true);
    });
    it('returns bounded safe related records and accurate overview totals', async () => {
      for (const resource of [
        'courses',
        'payments',
        'progress',
        'devices',
        'audit-logs',
      ]) {
        const result = await call(
          agents.SUPER_ADMIN,
          'get',
          '/admin/students/' + studentId + '/' + resource + '?pageSize=1',
        ).expect(200);
        expect(result.body.items.length).toBeLessThanOrEqual(1);
        expect(JSON.stringify(result.body)).not.toMatch(
          /password_hash|token_hash|refresh_hash/,
        );
      }
      const summary = await call(
        agents.SUPER_ADMIN,
        'get',
        '/dashboard',
      ).expect(200);
      expect(summary.body.metrics.students).toBe(
        await db.user.count({ where: { role: 'STUDENT' } }),
      );
      expect(Array.isArray(summary.body.revenue)).toBe(true);
      for (const path of [
        '/admin/records/enrollments',
        '/admin/records/progress',
        '/admin/records/devices',
        '/admin/revenue',
        '/admin/settings',
      ])
        await call(agents.SUPER_ADMIN, 'get', path).expect(200);
    });
    it('has no audit mutation endpoints', async () => {
      const event = await db.auditLog.findFirstOrThrow({
        where: { target_id: studentId },
      });
      await call(
        agents.SUPER_ADMIN,
        'patch',
        '/admin/students/' + studentId + '/audit-logs/' + event.id,
      )
        .send({ description: 'Edited history' })
        .expect(404);
      await agents.SUPER_ADMIN.delete('/api/v1/admin/audit-logs/' + event.id)
        .set('Origin', origin)
        .expect(404);
      expect(
        await db.auditLog.findUnique({ where: { id: event.id } }),
      ).not.toBeNull();
    });
  });
});
