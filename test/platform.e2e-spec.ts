import sharp from 'sharp';
import type { Question, Grade } from '../src/modules/assessments/questions.js';
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
    process.env.MAX_ACTIVE_STUDENT_DEVICES = '1';
    process.env.FIREBASE_PUSH_ENABLED = 'false';
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
      db.notification.deleteMany(),
      db.assessmentAttempt.deleteMany(),
      db.assessmentSubmission.deleteMany(),
      db.assessmentFile.deleteMany(),
      db.assessment.deleteMany(),
      db.refund.deleteMany(),
      db.auditLog.deleteMany(),
      db.learningProgress.deleteMany(),
      db.courseEntitlement.deleteMany(),
      db.enrollment.deleteMany(),
      db.payment.deleteMany(),
      db.lesson.deleteMany(),
      db.chapter.deleteMany(),
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
  it('allows a new client and sign-in after logout', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'student@freshman.test', password })
      .expect(200);
    await call(agents.STUDENT, 'post', '/auth/logout').expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'student@freshman.test', password })
      .expect(200);
    await call(agents.STUDENT, 'post', '/auth/login')
      .send({ email: 'student@freshman.test', password })
      .expect(200);
  });
  it('allows simultaneous password-authenticated logins on separate browsers', async () => {
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
      200, 200,
    ]);
    expect(
      [
        {
          count: await db.studentDevice.count({
            where: { user: { email: 'race@freshman.test' }, revoked_at: null },
          }),
        },
      ][0].count,
    ).toBe(2);
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
    const publicCard = await db.course.create({
      data: {
        title: 'Catalog metadata check',
        description: 'A course with protected learning content.',
        category: 'Health Sciences',
        instructor_id: ids.INSTRUCTOR,
        published: true,
        visibility: 'PUBLIC',
        price_minor: 30000,
        currency: 'ETB',
        lessons: {
          create: [
            {
              title: 'First',
              chapter: 'Foundations',
              position: 0,
              kind: 'TEXT',
              preview: true,
              content: 'private lesson body',
            },
            {
              title: 'Second',
              chapter: 'Foundations',
              position: 1,
              kind: 'QUIZ',
              preview: false,
              content: 'private quiz body',
            },
            {
              title: 'Third',
              chapter: 'Practice',
              position: 2,
              kind: 'TEXT',
              preview: false,
            },
          ],
        },
        assessments: {
          create: [
            {
              title: 'Released activity',
              kind: 'ASSIGNMENT',
              prompt: 'private instructions',
              published: true,
            },
            {
              title: 'Hidden draft',
              kind: 'EXAM',
              prompt: 'draft instructions',
              published: false,
            },
          ],
        },
      },
    });
    const privateCourse = await make('Private course', 'PRIVATE');
    const unlisted = await make('Unlisted course', 'UNLISTED');
    const draft = await make('Draft course', 'PUBLIC', false);
    const archived = await make('Archived course', 'PUBLIC', true, new Date());
    const catalog = await request(app.getHttpServer())
      .get('/api/v1/courses')
      .expect(200);
    const card = catalog.body.find(
      (item: { id: string }) => item.id === publicCard.id,
    );
    expect(card).toMatchObject({
      lesson_count: 3,
      chapter_count: 2,
      assessment_count: 1,
      enrollment_count: 0,
      preview_count: 1,
      quiz_count: 1,
    });
    expect(card).not.toHaveProperty('lessons');
    expect(card).not.toHaveProperty('assessments');
    expect(JSON.stringify(card)).not.toContain('private lesson body');
    expect(JSON.stringify(card)).not.toContain('Hidden draft');
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

  it('Course Studio: chapters, drafts, readiness, publishing and deletion', async () => {
    const studio = (
      method: 'get' | 'post' | 'patch' | 'put' | 'delete',
      path: string,
      agent = agents.INSTRUCTOR,
    ) => agent[method]('/api/v1/studio' + path).set('Origin', origin);
    const course = await call(agents.INSTRUCTOR, 'post', '/courses')
      .send({
        title: 'Studio workflow course',
        description: 'A free course used to exercise the Course Studio authoring workflow end to end.',
        category: 'Testing',
        price_minor: 0,
        currency: 'ETB',
        visibility: 'PUBLIC',
      })
      .expect(201);
    const id = course.body.id as string;
    expect(course.body.published).toBe(false);
    await studio('get', `/courses/${id}/curriculum`, agents.STUDENT).expect(403);
    expect((await studio('get', `/courses/${id}/curriculum`).expect(200)).body.chapters).toEqual([]);
    const basics = (await studio('post', `/courses/${id}/chapters`).send({ title: 'Basics' }).expect(201)).body.id;
    const advanced = (await studio('post', `/courses/${id}/chapters`).send({ title: 'Advanced' }).expect(201)).body.id;
    await studio('post', `/courses/${id}/chapters`).send({ title: 'Basics' }).expect(409);
    const lesson = async (chapter: string, title: string, kind: string) =>
      (await studio('post', `/courses/${id}/lessons`).send({ chapter_id: chapter, title, kind }).expect(201)).body.id as string;
    const welcome = await lesson(basics, 'Welcome', 'TEXT');
    const clip = await lesson(basics, 'Clip', 'VIDEO');
    const check = await lesson(advanced, 'Check', 'QUIZ');

    let ready = (await studio('get', `/courses/${id}/readiness`).expect(200)).body;
    expect(ready.ready).toBe(false);
    expect(ready.errors.map((e: { code: string }) => e.code).sort()).toEqual(['EMPTY_QUIZ', 'MISSING_FILE']);
    await studio('post', `/courses/${id}/publish`).send({ published: true }).expect(409);

    const draft = { title: 'Welcome', kind: 'TEXT', preview: true, practice: false, content: 'Welcome to the studio course. Read me first.' };
    const saved = await studio('patch', `/lessons/${welcome}/draft`).send({ ...draft, expected_revision: 1 }).expect(200);
    expect(saved.body.revision).toBe(2);
    await studio('patch', `/lessons/${welcome}/draft`).send({ ...draft, expected_revision: 1 }).expect(409);
    // Incomplete questions autosave fine but block publishing.
    await studio('patch', `/lessons/${check}/draft`)
      .send({ title: 'Check', kind: 'QUIZ', preview: false, practice: false, content: '', quiz: [{ question: '', options: ['', ''], correctIndex: 0 }], expected_revision: 1 })
      .expect(200);
    expect((await studio('get', `/courses/${id}/readiness`).expect(200)).body.errors.map((e: { code: string }) => e.code)).toContain('INVALID_QUIZ');
    await studio('patch', `/lessons/${check}/draft`)
      .send({ title: 'Check', kind: 'QUIZ', preview: false, practice: false, content: '', quiz: [{ question: 'Two plus two?', options: ['3', '4'], correctIndex: 1 }], expected_revision: 2 })
      .expect(200);
    expect((await studio('delete', `/lessons/${clip}`).expect(200)).body.deleted).toBe(true);
    ready = (await studio('get', `/courses/${id}/readiness`).expect(200)).body;
    expect(ready.errors).toEqual([]);

    // Move the quiz to the top of Basics, leaving Advanced empty.
    await studio('put', `/courses/${id}/curriculum`)
      .send({ chapters: [{ id: basics, lesson_ids: [check, welcome] }, { id: advanced, lesson_ids: [] }] })
      .expect(200);
    await studio('put', `/courses/${id}/curriculum`)
      .send({ chapters: [{ id: basics, lesson_ids: [check] }, { id: advanced, lesson_ids: [] }] })
      .expect(409);
    const rows = await db.lesson.findMany({ where: { course_id: id }, orderBy: { position: 'asc' } });
    expect(rows.map((r) => [r.title, r.position, r.chapter])).toEqual([['Check', 0, 'Basics'], ['Welcome', 1, 'Basics']]);
    await studio('patch', `/chapters/${basics}`).send({ title: 'Foundations' }).expect(200);
    expect((await db.lesson.findMany({ where: { course_id: id } })).every((r) => r.chapter === 'Foundations')).toBe(true);

    await studio('post', `/courses/${id}/publish`).send({ published: true }).expect(201);
    expect(await db.lesson.count({ where: { course_id: id, status: 'PUBLISHED' } })).toBe(2);
    await call(agents.STUDENT, 'post', `/enrollments/${id}/free`).expect(201);
    const learning = async () =>
      (await call(agents.STUDENT, 'get', `/courses/${id}/learning`).expect(200)).body.lessons.map((l: { title: string }) => l.title);
    expect(await learning()).toEqual(['Check', 'Welcome']);

    // Drafts stay invisible to students until "Publish changes".
    const secret = await lesson(advanced, 'Secret', 'TEXT');
    await call(agents.STUDENT, 'get', '/lessons/' + secret).expect(404);
    const current = (await studio('get', `/lessons/${welcome}`).expect(200)).body;
    await studio('patch', `/lessons/${welcome}/draft`).send({ ...draft, content: 'Version two of the welcome topic.', expected_revision: current.revision }).expect(200);
    const studentView = (await call(agents.STUDENT, 'get', '/lessons/' + welcome).expect(200)).body;
    expect(studentView.content).toBe(draft.content);
    expect(studentView).not.toHaveProperty('draft');
    expect(await learning()).toEqual(['Check', 'Welcome']);
    expect((await studio('get', `/courses/${id}/curriculum`).expect(200)).body.pending_changes).toBe(2);
    const before = await db.notification.count({ where: { user_id: ids.STUDENT, course_id: id } });
    const pub = await studio('post', `/courses/${id}/publish-changes`).send({}).expect(201);
    expect(pub.body).toMatchObject({ published: 2, created: 1, updated: 1 });
    expect(await db.notification.count({ where: { user_id: ids.STUDENT, course_id: id } })).toBe(before + 1);
    expect((await call(agents.STUDENT, 'get', '/lessons/' + welcome).expect(200)).body.content).toBe('Version two of the welcome topic.');
    expect(await learning()).toEqual(['Check', 'Welcome', 'Secret']);

    // Deleting removes the topic's progress; non-empty chapters cannot be deleted.
    await call(agents.STUDENT, 'post', '/lessons/' + welcome + '/complete').expect(201);
    expect((await studio('delete', `/lessons/${welcome}`).expect(200)).body.removed_progress_records).toBe(1);
    await studio('delete', `/chapters/${advanced}`).expect(409);
    const empty = (await studio('post', `/courses/${id}/chapters`).send({ title: 'Empty' }).expect(201)).body.id;
    await studio('delete', `/chapters/${empty}`).expect(200);
    expect(await db.auditLog.count({ where: { resource_id: welcome, action: 'LESSON_DELETED' } })).toBe(1);
    await studio('post', `/courses/${id}/publish`).send({ published: false }).expect(201);
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
  it('enforces learning deadlines, timers, attachments, attempts, results, and notification ownership', async () => {
    const members: Record<string, ReturnType<typeof request.agent>> = {};
    const userIds: Record<string, string> = {};
    for (const [key, role] of [
      ['author', 'INSTRUCTOR'],
      ['learner', 'STUDENT'],
      ['outsider', 'STUDENT'],
    ] as const) {
      const id = randomUUID();
      userIds[key] = id;
      const email = key + '-learning@freshman.test';
      await db.user.create({
        data: {
          id,
          email,
          name: 'Learning ' + key,
          role,
          role_id: role,
          password_hash: await bcrypt.hash(password, 4),
        },
      });
      members[key] = request.agent(app.getHttpServer());
      await call(members[key], 'post', '/auth/login')
        .send({ email, password })
        .expect(200);
    }
    const course = await db.course.create({
      data: {
        title: 'Learning experience tests',
        description: 'Isolated course for learning workflow tests',
        instructor_id: userIds.author,
        published: true,
        visibility: 'PUBLIC',
        price_minor: 0,
      },
    });
    await call(
      members.learner,
      'post',
      '/enrollments/' + course.id + '/free',
    ).expect(201);
    const create = (data: object) =>
      call(members.author, 'post', '/assessments/course/' + course.id).send({
        title: 'Written activity',
        kind: 'ASSIGNMENT',
        prompt: 'Explain your reasoning.',
        questions: ['What evidence supports your conclusion?'],
        max_score: 100,
        ...data,
      });
    const created = await create({
      allow_files: true,
      max_attempts: 2,
      results_published: false,
      due_at: new Date(Date.now() + 3600000).toISOString(),
    }).expect(201);
    const a = created.body;
    await call(members.outsider, 'get', '/assessments/' + a.id).expect(403);
    await call(
      members.author,
      'post',
      '/assessments/' + a.id + '/start',
    ).expect(403);
    const notices = await call(members.learner, 'get', '/notifications').expect(
      200,
    );
    expect(
      notices.body.items.some((n: { kind: string }) => n.kind === 'ASSIGNMENT'),
    ).toBe(true);
    expect(
      notices.body.items.some((n: { kind: string }) => n.kind === 'DEADLINE'),
    ).toBe(true);
    const noticeId = notices.body.items[0].id;
    await call(
      members.outsider,
      'patch',
      '/notifications/' + noticeId + '/read',
    ).expect(404);
    await call(
      members.learner,
      'patch',
      '/notifications/' + noticeId + '/read',
    ).expect(200);
    const count = await db.notification.count({
      where: { user_id: userIds.learner },
    });
    await call(members.learner, 'get', '/notifications').expect(200);
    expect(
      await db.notification.count({ where: { user_id: userIds.learner } }),
    ).toBe(count);
    const starts = await Promise.all([
      call(members.learner, 'post', '/assessments/' + a.id + '/start'),
      call(members.learner, 'post', '/assessments/' + a.id + '/start'),
    ]);
    expect(starts.map((r) => r.status)).toEqual([201, 201]);
    expect(starts[0].body.id).toBe(starts[1].body.id);
    await call(members.learner, 'post', '/assessments/' + a.id + '/attachment')
      .attach('file', Buffer.from('invalid'), {
        filename: 'invalid.pdf',
        contentType: 'application/pdf',
      })
      .expect(400);
    const file = await call(
      members.learner,
      'post',
      '/assessments/' + a.id + '/attachment',
    )
      .attach(
        'file',
        Buffer.from('My written response with supporting evidence.'),
        { filename: 'response.txt', contentType: 'text/plain' },
      )
      .expect(201);
    await call(
      members.outsider,
      'get',
      '/assessments/attachments/' + file.body.id,
    ).expect(403);
    const answer = {
      answers: ['Independent evidence supports the claim.'],
      expected_questions: a.questions,
      expected_prompt: a.prompt,
      expected_max_score: a.max_score,
      attempt_id: starts[0].body.id,
      attachment_id: file.body.id,
    };
    const submitted = await call(
      members.learner,
      'post',
      '/assessments/' + a.id + '/submit',
    )
      .send(answer)
      .expect(201);
    await call(members.learner, 'post', '/assessments/' + a.id + '/submit')
      .send(answer)
      .expect(409);
    await call(
      members.author,
      'patch',
      '/assessments/submissions/' + submitted.body.id + '/review',
    )
      .send({
        score: 85,
        feedback: 'Good evidence and a clear conclusion.',
        expected_attempt: 1,
      })
      .expect(200);
    const hidden = await call(
      members.learner,
      'get',
      '/assessments/' + a.id,
    ).expect(200);
    expect(hidden.body.submissions[0].score).toBeNull();
    expect(hidden.body.submissions[0].feedback).toBeNull();
    await call(members.outsider, 'patch', '/assessments/' + a.id + '/results')
      .send({ results_published: true })
      .expect(403);
    await call(members.author, 'patch', '/assessments/' + a.id + '/results')
      .send({ results_published: true })
      .expect(200);
    expect(
      (await call(members.learner, 'get', '/assessments/' + a.id).expect(200))
        .body.submissions[0].score,
    ).toBe(85);
    const retry = await call(
      members.learner,
      'post',
      '/assessments/' + a.id + '/start',
    ).expect(201);
    await call(members.learner, 'post', '/assessments/' + a.id + '/submit')
      .send({ ...answer, attachment_id: undefined, attempt_id: retry.body.id })
      .expect(201);
    await call(
      members.author,
      'patch',
      '/assessments/submissions/' + submitted.body.id + '/review',
    )
      .send({ score: 90, feedback: 'Stale review', expected_attempt: 1 })
      .expect(409);
    await call(
      members.learner,
      'post',
      '/assessments/' + a.id + '/start',
    ).expect(409);
    expect(
      await db.assessmentAttempt.count({
        where: { assessment_id: a.id, student_id: userIds.learner },
      }),
    ).toBe(2);
    const future = await create({
      opens_at: new Date(Date.now() + 3600000).toISOString(),
    }).expect(201);
    await call(
      members.learner,
      'post',
      '/assessments/' + future.body.id + '/start',
    ).expect(403);
    const closed = await create({
      due_at: new Date(Date.now() - 1000).toISOString(),
    }).expect(201);
    await call(
      members.learner,
      'post',
      '/assessments/' + closed.body.id + '/submit',
    )
      .send({ answer: 'Too late' })
      .expect(403);
    const timed = await create({ kind: 'EXAM', duration_minutes: 1 }).expect(
      201,
    );
    await call(
      members.learner,
      'post',
      '/assessments/' + timed.body.id + '/submit',
    )
      .send({ answer: 'Not started' })
      .expect(409);
    const unstarted = await call(
      members.learner,
      'get',
      '/assessments/' + timed.body.id,
    ).expect(200);
    expect(unstarted.body.questions).toEqual([]);
    expect(unstarted.body.question_count).toBe(1);
    const timer = await call(
      members.learner,
      'post',
      '/assessments/' + timed.body.id + '/start',
    ).expect(201);
    expect(timer.body.expires_at).toBeTruthy();
    expect(
      (
        await call(
          members.learner,
          'get',
          '/assessments/' + timed.body.id,
        ).expect(200)
      ).body.questions,
    ).toHaveLength(1);
    await db.assessmentAttempt.update({
      where: { id: timer.body.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    await call(
      members.learner,
      'post',
      '/assessments/' + timed.body.id + '/submit',
    )
      .send({ ...answer, attachment_id: undefined, attempt_id: timer.body.id })
      .expect(403);
    await call(members.author, 'post', '/notifications/course/' + course.id)
      .send({
        title: 'Welcome learners',
        message: 'Read the lesson before starting your work.',
      })
      .expect(201);
    const instructorNotices = await call(
      members.author,
      'get',
      '/notifications',
    ).expect(200);
    expect(
      instructorNotices.body.items.some(
        (n: { kind: string }) => n.kind === 'SUBMISSION',
      ),
    ).toBe(true);
    const quiz = await call(
      members.author,
      'post',
      '/lessons/course/' + course.id,
    )
      .send({
        title: 'Reasoning practice',
        chapter: 'Evidence and reasoning',
        position: 0,
        kind: 'QUIZ',
        practice: true,
        preview: false,
        content: 'Choose the supported conclusion.',
        quiz: [
          {
            question: 'What should evidence support?',
            options: ['The conclusion', 'The font choice'],
            correctIndex: 0,
            explanation: 'Reasons and evidence should support the conclusion.',
          },
        ],
      })
      .expect(201);
    const orderConflict = await call(
      members.author,
      'post',
      '/lessons/course/' + course.id,
    )
      .send({
        title: 'Duplicate topic order',
        chapter: 'Evidence and reasoning',
        position: 0,
        kind: 'TEXT',
        preview: false,
        content: 'A second topic cannot use an occupied order.',
      })
      .expect(409);
    expect(orderConflict.body.message).toContain('Content order 0');
    const safeQuiz = await call(
      members.learner,
      'get',
      '/lessons/' + quiz.body.id,
    ).expect(200);
    expect(safeQuiz.body.practice).toBe(true);
    expect(safeQuiz.body.chapter).toBe('Evidence and reasoning');
    const outline = await request(app.getHttpServer())
      .get('/api/v1/courses/' + course.id)
      .expect(200);
    expect(outline.body.lessons[0].chapter).toBe('Evidence and reasoning');
    expect(outline.body.lessons[0]).not.toHaveProperty('quiz');
    expect(safeQuiz.body.quiz[0]).not.toHaveProperty('correctIndex');
    expect(safeQuiz.body.quiz[0]).not.toHaveProperty('explanation');
    await call(members.author, 'post', '/lessons/' + quiz.body.id + '/quiz')
      .send({ answers: [0] })
      .expect(403);
    await call(members.learner, 'post', '/lessons/' + quiz.body.id + '/quiz')
      .send({ answers: [-1] })
      .expect(400);
    const failedQuiz = await call(
      members.learner,
      'post',
      '/lessons/' + quiz.body.id + '/quiz',
    )
      .send({ answers: [1] })
      .expect(201);
    expect(failedQuiz.body.passed).toBe(false);
    expect(failedQuiz.body).not.toHaveProperty('explanations');
    const passedQuiz = await call(
      members.learner,
      'post',
      '/lessons/' + quiz.body.id + '/quiz',
    )
      .send({ answers: [0] })
      .expect(201);
    expect(passedQuiz.body.passed).toBe(true);
    expect(passedQuiz.body.explanations[0].explanation).toContain('support');
    await db.notification.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        user_id: userIds.learner,
        event_key: 'paging-' + i,
        kind: 'SYSTEM',
        title: 'Inbox pagination test',
        message: 'Test notification in an isolated database.',
        href: '/notifications',
      })),
    });
    const firstPage = await call(
      members.learner,
      'get',
      '/notifications?unread=true',
    ).expect(200);
    expect(firstPage.body.items).toHaveLength(50);
    expect(firstPage.body.next_cursor).toBeTruthy();
    const secondPage = await call(
      members.learner,
      'get',
      '/notifications?unread=true&cursor=' + firstPage.body.next_cursor,
    ).expect(200);
    expect(secondPage.body.items.length).toBeGreaterThan(0);
    expect(
      secondPage.body.items.some((n: { id: string }) =>
        firstPage.body.items.some((p: { id: string }) => p.id === n.id),
      ),
    ).toBe(false);
    await call(members.learner, 'patch', '/notifications/read-all').expect(200);
    expect(
      (
        await call(members.learner, 'get', '/notifications?unread=true').expect(
          200,
        )
      ).body.unread,
    ).toBe(0);
    await call(members.learner, 'post', '/notifications/system')
      .send({ title: 'Denied announcement', message: 'Not permitted.' })
      .expect(403);
    await db.courseEntitlement.updateMany({
      where: { enrollment: { course_id: course.id, user_id: userIds.learner } },
      data: { state: 'REVOKED' },
    });
    const revoked = await call(members.learner, 'get', '/notifications').expect(
      200,
    );
    expect(
      revoked.body.items.some(
        (n: { course_id: string }) => n.course_id === course.id,
      ),
    ).toBe(false);
    await call(
      members.learner,
      'get',
      '/assessments/attachments/' + file.body.id,
    ).expect(403);
    await call(members.learner, 'get', '/assessments/' + a.id).expect(403);
  });
  it('builds typed exams, protects answer keys, autosaves, grades, and preserves attempts', async () => {
    const members: Record<string, ReturnType<typeof request.agent>> = {};
    const users: Record<string, string> = {};
    for (const [key, role] of [
      ['author', 'INSTRUCTOR'],
      ['learner', 'STUDENT'],
      ['outsider', 'STUDENT'],
    ] as const) {
      const user = await db.user.create({
        data: {
          email: `exam-${key}@freshman.test`,
          name: `Exam ${key}`,
          role,
          role_id: role,
          password_hash: await bcrypt.hash(password, 4),
        },
      });
      users[key] = user.id;
      members[key] = request.agent(app.getHttpServer());
      await call(members[key], 'post', '/auth/login')
        .send({ email: user.email, password })
        .expect(200);
    }
    const course = await db.course.create({
      data: {
        title: 'Typed exam test course',
        description: 'Isolated typed assessment tests',
        instructor_id: users.author,
        published: true,
        visibility: 'PUBLIC',
        price_minor: 0,
      },
    });
    await call(
      members.learner,
      'post',
      `/enrollments/${course.id}/free`,
    ).expect(201);
    const studio = await call(
      members.author,
      'get',
      `/courses/manage/${course.id}`,
    ).expect(200);
    expect(studio.body.title).toBe(course.title);
    expect(studio.body._count.enrollments).toBe(1);
    expect(studio.body).not.toHaveProperty('lessons');
    expect(studio.body).not.toHaveProperty('assessments');
    await call(members.learner, 'get', `/courses/manage/${course.id}`).expect(
      403,
    );
    await call(agents.INSTRUCTOR, 'get', `/courses/manage/${course.id}`).expect(
      403,
    );
    const values = {
      title: 'Six question types',
      kind: 'EXAM',
      prompt: 'Answer the objective questions, then explain your reasoning.',
      max_score: 30,
      published: false,
      question_bank: [],
      max_attempts: 1,
      results_published: false,
      review_policy: 'AFTER_CLOSE',
      due_at: new Date(Date.now() + 3600000).toISOString(),
      randomize_questions: true,
      randomize_options: true,
      allow_resume: true,
    };
    const draft = await call(
      members.author,
      'post',
      `/assessments/course/${course.id}`,
    )
      .send(values)
      .expect(201);
    const id = draft.body.id,
      path = `/assessments/${id}`;
    await call(members.learner, 'get', path).expect(404);
    expect(
      (
        await call(
          members.learner,
          'get',
          `/assessments/course/${course.id}`,
        ).expect(200)
      ).body,
    ).toEqual([]);
    const pixels = await sharp({
      create: { width: 2, height: 2, channels: 3, background: 'red' },
    })
      .png()
      .toBuffer();
    await call(members.outsider, 'post', `${path}/images`)
      .attach('file', pixels, {
        filename: 'test.png',
        contentType: 'image/png',
      })
      .expect(403);
    await call(members.author, 'post', `${path}/images`)
      .attach('file', Buffer.from('<svg></svg>'), {
        filename: 'test.svg',
        contentType: 'image/svg+xml',
      })
      .expect(400);
    const image = await call(members.author, 'post', `${path}/images`)
      .attach('file', pixels, {
        filename: 'test.png',
        contentType: 'image/png',
      })
      .expect(201);
    const base = {
      points: 5,
      difficulty: 'MEDIUM' as const,
      explanation: 'Detailed private answer explanation',
    };
    const bank: Question[] = [
      {
        ...base,
        id: 'mcq',
        type: 'MCQ',
        question: 'Choose both primes',
        options: [
          { id: 'a', text: '2' },
          { id: 'b', text: '3' },
          { id: 'c', text: '4' },
        ],
        correct: ['a', 'b'],
      },
      {
        ...base,
        id: 'blank',
        type: 'BLANK',
        question: 'Python is a ___ language.',
        accepted: [['high-level', 'high level']],
      },
      {
        ...base,
        id: 'boolean',
        type: 'BOOLEAN',
        question: 'Evidence never matters.',
        correct_boolean: false,
      },
      {
        ...base,
        id: 'short',
        type: 'SHORT',
        question: 'Explain the claim.',
        model_answer: 'A private model answer',
        grading_mode: 'MANUAL',
      },
      {
        ...base,
        id: 'code',
        type: 'CODE',
        question: 'Return the integer two.',
        model_answer: 'return 2',
        language: 'python',
        starter_code: '# write code',
        samples: [{ input: '', output: '2' }],
        time_limit_ms: 2000,
        memory_limit_mb: 128,
      },
      {
        ...base,
        id: 'image',
        type: 'IMAGE',
        response_type: 'BOOLEAN',
        question: 'Is this image red?',
        image_id: image.body.id,
        image_alt: 'A small red square',
        correct_boolean: true,
      },
    ];
    const published = {
      ...values,
      published: true,
      question_bank: bank,
      expected_revision: draft.body.revision,
    };
    await call(members.author, 'patch', path)
      .send({
        ...published,
        question_bank: bank.map((q) => ({ ...q, explanation: '' })),
      })
      .expect(400);
    const exam = (
      await call(members.author, 'patch', path).send(published).expect(200)
    ).body;
    await call(agents.INSTRUCTOR, 'get', path).expect(403);
    await call(members.outsider, 'get', path).expect(403);
    const before = (await call(members.learner, 'get', path).expect(200)).body;
    expect(before.question_bank).toEqual([]);
    expect(before.answer_review).toEqual([]);
    await call(
      members.learner,
      'get',
      `/assessments/images/${image.body.id}`,
    ).expect(403);
    const started = (
      await call(members.learner, 'post', `${path}/start`).expect(201)
    ).body;
    const safe = (await call(members.learner, 'get', path).expect(200)).body;
    expect(safe.question_bank).toHaveLength(6);
    expect(safe.has_attempts).toBe(false);
    expect(safe.attempts[0]).not.toHaveProperty('access_key');
    for (const q of safe.question_bank)
      for (const key of [
        'correct',
        'accepted',
        'correct_boolean',
        'explanation',
        'model_answer',
      ])
        expect(q).not.toHaveProperty(key);
    await call(
      members.learner,
      'get',
      `/assessments/images/${image.body.id}`,
    ).expect(200);
    const responses = {
      mcq: ['b', 'a'],
      blank: ['HIGH LEVEL'],
      boolean: false,
      short: 'My reasoning',
      code: 'print(2)',
      image: true,
    };
    await call(members.outsider, 'patch', `${path}/draft`)
      .send({ attempt_id: started.id, responses, save_version: 0 })
      .expect(403);
    await call(members.learner, 'patch', `${path}/draft`)
      .send({
        attempt_id: started.id,
        responses: { bad: 'injected' },
        save_version: 0,
      })
      .expect(400);
    await call(members.learner, 'patch', `${path}/draft`)
      .send({
        attempt_id: started.id,
        responses,
        marked: ['short'],
        save_version: 0,
      })
      .expect(200);
    await call(members.learner, 'patch', `${path}/draft`)
      .send({ attempt_id: started.id, responses, save_version: 0 })
      .expect(409);
    const resumed = (
      await call(members.learner, 'post', `${path}/start`).expect(201)
    ).body;
    expect(resumed.id).toBe(started.id);
    expect(resumed.responses).toEqual(responses);
    expect(resumed.marked).toEqual(['short']);
    const submit = {
      attempt_id: started.id,
      responses,
      expected_revision: exam.revision,
      save_version: 1,
    };
    await call(members.learner, 'post', `${path}/submit`)
      .send({ ...submit, save_version: 0 })
      .expect(409);
    const result = (
      await call(members.learner, 'post', `${path}/submit`)
        .send(submit)
        .expect(201)
    ).body;
    expect(result.score).toBeNull();
    expect(result.pending_review).toBe(true);
    expect(result).not.toHaveProperty('grading');
    const repeat = (
      await call(members.learner, 'post', `${path}/submit`)
        .send(submit)
        .expect(201)
    ).body;
    expect(repeat.id).toBe(result.id);
    await call(members.author, 'patch', path).send(published).expect(409);
    await members.author
      .delete('/api/v1' + path)
      .set('Origin', origin)
      .expect(409);
    const submission = await db.assessmentSubmission.findUniqueOrThrow({
      where: { id: result.id },
    });
    const grading = submission.grading as Grade[];
    expect(grading.filter((g) => g.earned === null)).toHaveLength(2);
    const graded = grading.map((g) => ({
      ...g,
      earned: g.points,
      feedback: 'Reviewed correctly',
    }));
    await call(
      members.author,
      'patch',
      `/assessments/submissions/${result.id}/review`,
    )
      .send({
        score: 30,
        feedback: 'Well done',
        expected_attempt: 1,
        grading: graded.map((g) => ({ ...g, earned: 100 })),
      })
      .expect(400);
    await call(
      members.author,
      'patch',
      `/assessments/submissions/${result.id}/review`,
    )
      .send({
        score: 30,
        feedback: 'Well done',
        expected_attempt: 1,
        grading: graded,
      })
      .expect(200);
    expect(
      (await call(members.learner, 'get', path).expect(200)).body.submissions[0]
        .score,
    ).toBeNull();
    await call(members.author, 'patch', `${path}/results`)
      .send({ results_published: true })
      .expect(200);
    const waiting = (await call(members.learner, 'get', path).expect(200)).body;
    expect(waiting.submissions[0].score).toBe(30);
    expect(waiting.answer_review).toEqual([]);
    expect(waiting.submissions[0].grading).toEqual([]);
    await db.assessment.update({
      where: { id },
      data: { due_at: new Date(Date.now() - 1000) },
    });
    const review = (await call(members.learner, 'get', path).expect(200)).body;
    expect(review.answer_review).toHaveLength(6);
    expect(
      review.answer_review.find((q: Question) => q.id === 'code').model_answer,
    ).toBe('return 2');
    const copied = (
      await call(members.author, 'post', `${path}/duplicate`).expect(201)
    ).body;
    expect(copied.published).toBe(false);
    expect(
      copied.question_bank.find((q: Question) => q.id === 'image').image_id,
    ).not.toBe(image.body.id);
    expect(
      await db.assessmentAttempt.count({ where: { assessment_id: id } }),
    ).toBe(1);
    const objective = (
      await call(members.author, 'post', `/assessments/course/${course.id}`)
        .send({
          ...values,
          title: 'Objective never-review exam',
          question_bank: bank.slice(0, 3),
          published: true,
          results_published: true,
          review_policy: 'NEVER',
          due_at: null,
          allow_resume: false,
        })
        .expect(201)
    ).body;
    const op = `/assessments/${objective.id}`;
    const active = (
      await call(members.learner, 'post', `${op}/start`).expect(201)
    ).body;
    await call(members.learner, 'post', `${op}/start`).expect(409);
    await call(members.learner, 'patch', `${op}/draft`)
      .send({
        attempt_id: active.id,
        responses: { boolean: false },
        save_version: 0,
      })
      .expect(403);
    const done = (
      await call(members.learner, 'post', `${op}/submit`)
        .send({
          attempt_id: active.id,
          attempt_key: active.access_key,
          save_version: 0,
          responses: { mcq: ['a', 'b'], blank: ['high-level'], boolean: false },
        })
        .expect(201)
    ).body;
    expect(done.score).toBe(15);
    expect(done.pending_review).toBe(false);
    expect(done).not.toHaveProperty('grading');
    const never = (await call(members.learner, 'get', op).expect(200)).body;
    expect(never.answer_review).toEqual([]);
    expect(never.question_bank).toEqual([]);
    expect(never.submissions[0].grading).toEqual([]);
    await db.courseEntitlement.updateMany({
      where: { enrollment: { course_id: course.id, user_id: users.learner } },
      data: { state: 'REVOKED' },
    });
    await call(members.learner, 'get', path).expect(403);
    await call(
      members.learner,
      'get',
      `/assessments/images/${image.body.id}`,
    ).expect(403);
  }, 60000);
  it('binds installation identity independently of refreshed FCM tokens and revokes access after reset', async () => {
    process.env.PUSH_TOKEN_ENCRYPTION_KEY = 'b'.repeat(64);
    const install = randomUUID(),
      first = request.agent(app.getHttpServer()),
      second = request.agent(app.getHttpServer());
    const email = `device-${randomUUID()}@freshman.test`;
    await call(first, 'post', '/auth/register')
      .send({
        email,
        password,
        name: 'Device learner',
        installation_id: install,
      })
      .expect(201);
    const registration = {
      installation_id: install,
      browser: 'Test browser',
      operating_system: 'Test OS',
      fcm_token: 'test-fcm-registration-token-one',
    };
    await call(first, 'post', '/devices/me/register')
      .send(registration)
      .expect(201);
    const before = await call(first, 'get', '/devices/me').expect(200);
    expect(JSON.stringify(before.body)).not.toContain('test-fcm');
    expect(before.body).not.toHaveProperty('installation_hash');
    await call(first, 'post', '/devices/me/register')
      .send({ ...registration, fcm_token: 'test-fcm-registration-token-two' })
      .expect(201);
    const after = await call(first, 'get', '/devices/me').expect(200);
    expect(after.body.id).toBe(before.body.id);
    const stored = await db.studentDevice.findUniqueOrThrow({
      where: { id: before.body.id },
    });
    expect(stored.fcm_token_encrypted).not.toContain('test-fcm');
    await call(second, 'post', '/auth/login')
      .send({ email, password, installation_id: install })
      .expect(409);
    await call(first, 'post', '/devices/me/register')
      .send({ ...registration, installation_id: randomUUID() })
      .expect(409);
    const target = await db.user.findUniqueOrThrow({ where: { email } });
    await call(first, 'post', '/devices/me/change-request')
      .send({ reason: 'Replacing a damaged learning installation' })
      .expect(201);
    await call(first, 'post', '/devices/me/change-request')
      .send({ reason: 'Replacing a damaged learning installation' })
      .expect(201);
    const requests = await call(
      agents.SUPER_ADMIN,
      'get',
      '/devices/requests',
    ).expect(200);
    expect(
      requests.body.filter(
        (row: { student_id: string }) => row.student_id === target.id,
      ),
    ).toHaveLength(1);
    await call(first, 'get', '/auth/me').expect(200);
    await call(
      agents.SUPER_ADMIN,
      'post',
      `/devices/student/${target.id}/reset`,
    )
      .send({ reason: 'Verified administrative device recovery' })
      .expect(201);
    await call(first, 'get', '/auth/me').expect(401);
    await call(second, 'post', '/auth/login')
      .send({ email, password, installation_id: randomUUID() })
      .expect(200);
    delete process.env.PUSH_TOKEN_ENCRYPTION_KEY;
  });
  it('transfers course ownership only through Super Admin and immediately changes management scope', async () => {
    const owner = await db.user.create({
      data: {
        email: `owner-${randomUUID()}@freshman.test`,
        name: 'New course owner',
        role: 'INSTRUCTOR',
        role_id: 'INSTRUCTOR',
        password_hash: await bcrypt.hash(password, 12),
      },
    });
    const course = await db.course.create({
      data: {
        title: 'Ownership fixture',
        description: 'Ownership test course with preserved records',
        category: 'General',
        price_minor: 0,
        instructor_id: ids.INSTRUCTOR,
      },
    });
    const other = request.agent(app.getHttpServer());
    await call(other, 'post', '/auth/login')
      .send({ email: owner.email, password })
      .expect(200);
    await call(other, 'get', `/courses/manage/${course.id}`).expect(403);
    await call(other, 'post', `/courses/${course.id}/owner`)
      .send({
        instructor_id: owner.id,
        reason: 'Unauthorized transfer attempt',
      })
      .expect(403);
    await call(agents.SUPER_ADMIN, 'post', `/courses/${course.id}/owner`)
      .send({
        instructor_id: owner.id,
        reason: 'Verified assignment to a new instructor',
      })
      .expect(201);
    await call(other, 'get', `/courses/manage/${course.id}`).expect(200);
    await call(agents.INSTRUCTOR, 'get', `/courses/manage/${course.id}`).expect(
      403,
    );
    const list = await call(other, 'get', '/courses/manage/list').expect(200);
    expect(
      list.body.every(
        (item: { instructor_id: string }) => item.instructor_id === owner.id,
      ),
    ).toBe(true);
    const summary = await call(
      agents.SUPER_ADMIN,
      'get',
      '/dashboard?days=7',
    ).expect(200);
    expect(summary.body.analytics.days).toBe(7);
    expect(summary.body.metrics.free_courses).toBeGreaterThan(0);
    const expected = await db.payment.aggregate({
      where: { status: 'SUCCEEDED', mode: 'live', currency: 'ETB' },
      _sum: { amount_minor: true },
    });
    expect(
      summary.body.revenue.find(
        (row: { currency: string }) => row.currency === 'ETB',
      )?.amount_minor ?? 0,
    ).toBe(expected._sum.amount_minor ?? 0);
  });
  it('allows additional browsers without revoking existing authenticated sessions', async () => {
    process.env.MAX_ACTIVE_STUDENT_DEVICES = '2';
    try {
      const email = `multi-${randomUUID()}@freshman.test`;
      const first = request.agent(app.getHttpServer()),
        second = request.agent(app.getHttpServer()),
        third = request.agent(app.getHttpServer());
      await call(first, 'post', '/auth/register')
        .send({
          email,
          password,
          name: 'Two-installation learner',
          installation_id: randomUUID(),
        })
        .expect(201);
      await call(second, 'post', '/auth/login')
        .send({ email, password, installation_id: randomUUID() })
        .expect(200);
      await call(first, 'get', '/auth/me').expect(200);
      const a = await call(first, 'get', '/devices/me').expect(200),
        b = await call(second, 'get', '/devices/me').expect(200);
      expect(a.body.id).not.toBe(b.body.id);
      await call(third, 'post', '/auth/login')
        .send({ email, password, installation_id: randomUUID() })
        .expect(200);
    } finally {
      process.env.MAX_ACTIVE_STUDENT_DEVICES = '1';
    }
  });
  it('converts a student to instructor and back without losing learning or owned course records', async () => {
    const id=randomUUID(), email=`role-cycle-${id}@freshman.test`;
    await db.user.create({data:{id,email,name:'Role cycle learner',password_hash:await bcrypt.hash(password,4),role:'STUDENT',role_id:'STUDENT'}});
    const purchase=await db.payment.create({data:{user_id:id,course_id:courseId,tx_ref:'role-cycle-'+id,amount_minor:12500,currency:'ETB',idempotency_key:randomUUID(),status:'SUCCEEDED',mode:'test'}});
    const enrollment=await db.enrollment.create({data:{user_id:id,course_id:courseId,payment_id:purchase.id}});
    await db.learningProgress.create({data:{user_id:id,lesson_id:lessonId}});
    const student=request.agent(app.getHttpServer());
    await call(student,'post','/auth/login').send({email,password}).expect(200);
    await call(agents.ADMIN,'patch',`/users/${id}`).send({role:'INSTRUCTOR'}).expect(403);
    await call(student,'patch',`/users/${id}`).send({role:'INSTRUCTOR'}).expect(403);
    const promoted=await call(agents.SUPER_ADMIN,'patch',`/users/${id}`).send({role:'INSTRUCTOR'}).expect(200);
    expect(promoted.body.role).toBe('INSTRUCTOR');
    await call(student,'get','/auth/me').expect(401);
    const instructor=request.agent(app.getHttpServer());
    await call(instructor,'post','/auth/login').send({email,password}).expect(200);
    const owned=await call(instructor,'post','/courses').send({title:'Retained instructor course',description:'Course preserved when the instructor returns to learning.',category:'General',price_minor:0,currency:'ETB',published:false,visibility:'PRIVATE'}).expect(201);
    await call(agents.SUPER_ADMIN,'patch',`/users/${id}`).send({role:'STUDENT'}).expect(200);
    await call(instructor,'get','/auth/me').expect(401);
    const returned=await db.user.findUniqueOrThrow({where:{id}});
    expect(returned.role).toBe('STUDENT'); expect(returned.role_id).toBe('STUDENT');
    expect(await db.enrollment.count({where:{id:enrollment.id,user_id:id,payment_id:purchase.id}})).toBe(1);
    expect((await db.payment.findUniqueOrThrow({where:{id:purchase.id}})).status).toBe('SUCCEEDED');
    expect(await db.learningProgress.count({where:{user_id:id,lesson_id:lessonId}})).toBe(1);
    expect((await db.course.findUniqueOrThrow({where:{id:owned.body.id}})).instructor_id).toBe(id);
    const again=request.agent(app.getHttpServer());
    await call(again,'post','/auth/login').send({email,password}).expect(200);
    await call(again,'patch',`/courses/${owned.body.id}`).send({title:'Not allowed'}).expect(403);
    expect(await db.auditLog.count({where:{target_id:id,action:'ROLE_CHANGED'}})).toBe(2);
  });

});
