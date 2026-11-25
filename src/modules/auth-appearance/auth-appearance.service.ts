import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { CurrentUser } from '../../common/types.js';
import { deleteCloudinaryImage, uploadCloudinaryImage } from '../../common/cloudinary.js';
import type { AuthAppearanceDto } from './auth-appearance.dto.js';

export const DEFAULT_AUTH_APPEARANCE = {
  headline: 'Your next chapter starts here.',
  description: 'Build practical skills, learn from expert-led courses, and keep moving toward the future you want.',
  slogan: 'Learn Today. Innovate Tomorrow.',
  overlay_opacity: 0.48,
};

@Injectable()
export class AuthAppearanceService {
  constructor(private readonly db: PrismaService) {}

  private safe(row: { headline: string; description: string; slogan: string; overlay_opacity: number; secure_url: string | null; updated_at: Date }) {
    return { headline: row.headline, description: row.description, slogan: row.slogan, overlay_opacity: row.overlay_opacity, background_url: row.secure_url, updated_at: row.updated_at };
  }

  async publicAppearance() {
    const row = await this.db.authAppearance.findUnique({ where: { id: 'default' } });
    return row ? this.safe(row) : { ...DEFAULT_AUTH_APPEARANCE, background_url: null, updated_at: null };
  }

  async adminAppearance() {
    const row = await this.db.authAppearance.findUnique({ where: { id: 'default' } });
    return row ? { ...this.safe(row), public_id: row.public_id, mime_type: row.mime_type } : { ...DEFAULT_AUTH_APPEARANCE, background_url: null, public_id: null, mime_type: null, updated_at: null };
  }

  async update(user: CurrentUser, dto: AuthAppearanceDto, file?: Express.Multer.File) {
    const opacity = dto.overlay_opacity === undefined ? undefined : Number(dto.overlay_opacity);
    if (opacity !== undefined && (!Number.isFinite(opacity) || opacity < 0 || opacity > 1)) throw new ConflictException('Overlay opacity must be between 0 and 1');
    if (file) {
      if (file.size > 5 * 1024 * 1024) throw new ConflictException('Background image must be 5 MB or smaller');
      const b = file.buffer;
      const mime = b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'image/png' : b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff ? 'image/jpeg' : b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' ? 'image/webp' : null;
      if (!mime) throw new ConflictException('Background must be a valid PNG, JPEG, or WebP image');
      const previous = await this.db.authAppearance.findUnique({ where: { id: 'default' }, select: { public_id: true } });
      const uploaded = await uploadCloudinaryImage(b, mime, `learnova/auth-backgrounds/${randomUUID()}`);
      try {
        await this.db.authAppearance.upsert({ where: { id: 'default' }, create: { id: 'default', headline: dto.headline ?? DEFAULT_AUTH_APPEARANCE.headline, description: dto.description ?? DEFAULT_AUTH_APPEARANCE.description, slogan: dto.slogan ?? DEFAULT_AUTH_APPEARANCE.slogan, overlay_opacity: opacity ?? DEFAULT_AUTH_APPEARANCE.overlay_opacity, public_id: uploaded.public_id, secure_url: uploaded.secure_url, mime_type: mime }, update: { ...(dto.headline !== undefined && { headline: dto.headline }), ...(dto.description !== undefined && { description: dto.description }), ...(dto.slogan !== undefined && { slogan: dto.slogan }), ...(opacity !== undefined && { overlay_opacity: opacity }), public_id: uploaded.public_id, secure_url: uploaded.secure_url, mime_type: mime } });
      } catch (error) { await deleteCloudinaryImage(uploaded.public_id).catch(() => undefined); throw error; }
      if (previous?.public_id) await deleteCloudinaryImage(previous.public_id).catch(() => undefined);
    } else {
      await this.db.authAppearance.upsert({ where: { id: 'default' }, create: { id: 'default', headline: dto.headline ?? DEFAULT_AUTH_APPEARANCE.headline, description: dto.description ?? DEFAULT_AUTH_APPEARANCE.description, slogan: dto.slogan ?? DEFAULT_AUTH_APPEARANCE.slogan, overlay_opacity: opacity ?? DEFAULT_AUTH_APPEARANCE.overlay_opacity }, update: { ...(dto.headline !== undefined && { headline: dto.headline }), ...(dto.description !== undefined && { description: dto.description }), ...(dto.slogan !== undefined && { slogan: dto.slogan }), ...(opacity !== undefined && { overlay_opacity: opacity }) } });
    }
    return this.adminAppearance();
  }

  async restore() {
    const previous = await this.db.authAppearance.findUnique({ where: { id: 'default' }, select: { public_id: true } });
    await this.db.authAppearance.deleteMany({ where: { id: 'default' } });
    if (previous?.public_id) await deleteCloudinaryImage(previous.public_id).catch(() => undefined);
    return this.publicAppearance();
  }
}
