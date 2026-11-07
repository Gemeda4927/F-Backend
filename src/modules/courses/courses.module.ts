import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
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
  @Public() @Get('indexable') indexable() {
    return this.service.indexable();
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
  @Get('manage/:id/thumbnail') async authorizedThumbnail(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const image = await this.service.authorizedThumbnail(u, id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.mime_type).send(Buffer.from(image.content));
  }
  @Permissions('courses:write')
  @Post('manage/:id/thumbnail')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  uploadThumbnail(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file?.buffer?.length)
      throw new BadRequestException('Choose a PNG, JPEG, or WebP image');
    const b = file.buffer;
    const mime =
      b.length >= 8 &&
      b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? 'image/png'
        : b.length >= 4 &&
            b[0] === 0xff &&
            b[1] === 0xd8 &&
            b[b.length - 2] === 0xff &&
            b[b.length - 1] === 0xd9
          ? 'image/jpeg'
          : b.length >= 12 &&
              b.toString('ascii', 0, 4) === 'RIFF' &&
              b.toString('ascii', 8, 12) === 'WEBP'
            ? 'image/webp'
            : null;
    if (!mime || mime !== file.mimetype)
      throw new BadRequestException('Image type must be PNG, JPEG, or WebP');
    return this.service.saveThumbnail(u, id, b, mime);
  }
  @Permissions('courses:write') @Delete('manage/:id/thumbnail') removeThumbnail(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.removeThumbnail(u, id);
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
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.archive(u, id, true);
  }
  @Permissions('courses:write') @Post(':id/restore') restore(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.archive(u, id, false);
  }
  @Get(':id/access') async access(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return { access: await this.service.canAccess(u, id) };
  }
  @Get(':id/learning') learning(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.learningDetails(u, id);
  }
  @Public() @Get(':id/thumbnail') async publicThumbnail(
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const image = await this.service.publicThumbnail(id);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.mime_type).send(Buffer.from(image.content));
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
