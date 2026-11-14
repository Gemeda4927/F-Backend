import {
  Body,
  CallHandler,
  Controller,
  ExecutionContext,
  Injectable,
  type NestInterceptor,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  Patch,
  Res,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync, unlinkSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  Permissions,
  Public,
  User,
} from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { CoursesModule } from '../courses/courses.module.js';
import { CoursesService } from '../courses/courses.service.js';
import { LessonDto, QuizSubmissionDto } from './lessons.dto.js';
import { LessonsService } from './lessons.service.js';
import { removePrivateFile } from './storage.js';
import type { AuthRequest } from '../../common/types.js';

/**
 * Runs before Multer writes anything to disk: only the course owner (or an admin)
 * may stream a file into a PDF/VIDEO topic.
 */
@Injectable()
class LessonUploadGuard implements NestInterceptor {
  constructor(
    private readonly db: PrismaService,
    private readonly courses: CoursesService,
  ) {}
  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const id = String(req.params.id ?? '');
    const lesson = /^[0-9a-f-]{36}$/i.test(id)
      ? await this.db.lesson.findUnique({
          where: { id },
          select: { course_id: true, kind: true, draft: true },
        })
      : null;
    if (!lesson) throw new NotFoundException('Topic not found');
    await this.courses.assertOwner(req.user, lesson.course_id);
    const kind =
      (lesson.draft as { kind?: string } | null)?.kind ?? lesson.kind;
    if (!['PDF', 'VIDEO'].includes(kind))
      throw new BadRequestException(
        'Only PDF and video topics accept uploaded material',
      );
    return next.handle();
  }
}
@Controller('lessons')
class LessonsController {
  constructor(
    private readonly service: LessonsService,
    private readonly courses: CoursesService,
    private readonly db: PrismaService,
  ) {}
  @Public() @Get(':id/preview') preview(
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.preview(id);
  }
  @Permissions('courses:write')
  @Get('course/:id/manage')
  async manage(
    @User() user: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.courses.assertOwner(user, id);
    return this.db.lesson.findMany({
      where: { course_id: id },
      select: {
        id: true,
        title: true,
        chapter: true,
        position: true,
        kind: true,
        preview: true,
        content: true,
        quiz: true,
        practice: true,
        chapter_id: true,
        status: true,
        draft: true,
        revision: true,
        storage_path: true,
      },
      orderBy: { position: 'asc' },
    }).then((rows) =>
      rows.map(({ storage_path, draft, ...row }) => ({
        ...row,
        has_file: !!storage_path,
        has_draft: !!draft,
      })),
    );
  }
  @Get('course/:id/progress') progress(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.progress(u, id);
  }
  @Get(':id') detail(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(u, id);
  }
  @Permissions('courses:write') @Post('course/:id') create(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LessonDto,
  ) {
    return this.service.save(u, id, dto);
  }
  @Permissions('courses:write') @Patch('course/:courseId/:id') update(
    @User() u: CurrentUser,
    @Param('courseId', ParseUUIDPipe) courseId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: LessonDto,
  ) {
    return this.service.save(u, courseId, dto, id);
  }
  @Post(':id/complete') complete(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.complete(u, id);
  }
  @Post(':id/quiz') quiz(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: QuizSubmissionDto,
  ) {
    return this.service.complete(u, id, dto.answers);
  }
  @Permissions('courses:write')
  @Post(':id/asset')
  @UseInterceptors(
    LessonUploadGuard,
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          const dir = resolve(
            process.env.PRIVATE_STORAGE_DIR ?? 'private-storage',
          );
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) =>
          cb(
            null,
            randomUUID() +
              (file.mimetype === 'application/pdf'
                ? '.pdf'
                : file.mimetype === 'video/webm'
                  ? '.webm'
                  : '.mp4'),
          ),
      }),
      limits: { fileSize: 200 * 1024 * 1024 },
      fileFilter: (_req, file, cb) =>
        cb(
          null,
          ['application/pdf', 'video/mp4', 'video/webm'].includes(
            file.mimetype,
          ),
        ),
    }),
  )
  async upload(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: { path: string; filename: string; mimetype: string },
  ) {
    if (!file)
      throw new BadRequestException(
        'Upload a PDF, MP4 or WebM file (max 200 MB)',
      );
    try {
      const lesson = await this.db.lesson.findUnique({ where: { id } });
      if (!lesson) throw new NotFoundException();
      await this.courses.assertOwner(u, lesson.course_id);
      const kind =
        (lesson.draft as { kind?: string } | null)?.kind ?? lesson.kind;
      if (
        (kind === 'PDF' && file.mimetype !== 'application/pdf') ||
        (kind === 'VIDEO' && !file.mimetype.startsWith('video/')) ||
        !['PDF', 'VIDEO'].includes(kind)
      )
        throw new BadRequestException('File type must match the lesson');
      await this.db.lesson.update({
        where: { id },
        data: { storage_path: file.filename },
      });
      if (lesson.storage_path && lesson.storage_path !== file.filename)
        removePrivateFile(lesson.storage_path);
      return { message: 'Protected material uploaded' };
    } catch (error) {
      unlinkSync(file.path);
      throw error;
    }
  }
  @Get(':id/file') async file(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const lesson = await this.service.authorized(u, id);
    if (!lesson.storage_path)
      throw new NotFoundException('Material has not been uploaded');
    const root = resolve(process.env.PRIVATE_STORAGE_DIR ?? 'private-storage');
    const path = resolve(root, lesson.storage_path);
    if (!path.startsWith(root + sep)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(path, { dotfiles: 'allow' });
  }
  @Public() @Get(':id/preview/file') async previewFile(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const lesson = await this.service.authorized(undefined, id);
    if (!lesson.storage_path) throw new NotFoundException();
    const root = resolve(process.env.PRIVATE_STORAGE_DIR ?? 'private-storage'),
      path = resolve(root, lesson.storage_path);
    if (!path.startsWith(root + sep)) throw new NotFoundException();
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(path, { dotfiles: 'allow' });
  }
}
@Module({
  imports: [CoursesModule],
  controllers: [LessonsController],
  providers: [LessonsService],
})
export class LessonsModule {}
