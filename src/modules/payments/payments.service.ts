import { notify } from '../notifications/notifications.js';
import {
  BadGatewayException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../../common/types.js';
import { audit } from '../audit/audit.js';
import { ChapaGateway, minorUnits, chapaDescription } from './chapa.gateway.js';
import type { CreatePaymentDto } from './payments.dto.js';
import type { ManualPaymentDto } from './payments.dto.js';
import { uploadCloudinaryFile } from '../../common/cloudinary.js';
export function validWebhook(
  raw: Buffer,
  signature: string | undefined,
  legacy: string | undefined,
  secret: string | undefined,
) {
  if (!secret) return false;
  const compare = (value: string | undefined, expected: string) =>
    !!value &&
    /^[a-f0-9]{64}$/i.test(value) &&
    timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
  return (
    compare(
      signature,
      createHmac('sha256', secret).update(raw).digest('hex'),
    ) ||
    compare(legacy, createHmac('sha256', secret).update(secret).digest('hex'))
  );
}
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: PrismaService,
    private readonly gateway: ChapaGateway,
  ) {}
  private validateReceipt(file?: Express.Multer.File) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024)
      throw new ConflictException('Payment receipt must be 5 MB or smaller');
    const mime = file.mimetype;
    const b = file.buffer;
    const jpeg = mime === 'image/jpeg' && b.length > 4 && b[0] === 0xff && b[1] === 0xd8 && b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9;
    const png = mime === 'image/png' && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const webp = mime === 'image/webp' && b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP';
    const pdf = mime === 'application/pdf' && b.subarray(0, 5).toString() === '%PDF-';
    if (!(jpeg || png || webp || pdf))
      throw new ConflictException('Receipt must be a valid JPEG, PNG, WebP, or PDF file');
  }
  async createManual(user: CurrentUser, dto: ManualPaymentDto, file?: Express.Multer.File) {
    if (user.role !== 'STUDENT') throw new ForbiddenException('Student account required');
    this.validateReceipt(file);
    if (!dto.reference_number && !file) throw new ConflictException('Add a transaction reference or upload a payment receipt');
    const amount = Math.round(Number(dto.amount_paid) * 100);
    if (!Number.isSafeInteger(amount) || amount <= 0) throw new ConflictException('Enter a valid amount paid');
    const course = await this.db.course.findFirst({ where: { id: dto.course_id, published: true, archived_at: null, visibility: 'PUBLIC' } });
    if (!course || course.price_minor <= 0) throw new ConflictException('Select a published paid course');
    if (amount !== course.price_minor) throw new ConflictException('Amount paid must match the course amount due');
    const reference = dto.reference_number?.trim() || undefined;
    if (reference) {
      const reused = await this.db.payment.findUnique({ where: { provider_ref: reference }, select: { id: true, status: true } });
      if (reused) throw new ConflictException('This transaction reference has already been submitted');
    }
    const existing = await this.db.enrollment.findUnique({ where: { user_id_course_id: { user_id: user.id, course_id: course.id } } });
    if (existing) throw new ConflictException('You already have access to this course');
    const prior = await this.db.payment.findFirst({ where: { user_id: user.id, course_id: course.id, status: 'PENDING' }, orderBy: { created_at: 'desc' } });
    if (prior) return prior;
    let asset: { public_id: string; secure_url: string; resource_type: string; bytes: number } | undefined;
    if (file) asset = await uploadCloudinaryFile(file.buffer, file.mimetype, `learnova/payment-receipts/${randomUUID()}`);
    return this.db.payment.create({ data: {
      user_id: user.id, course_id: course.id, tx_ref: 'manual-' + randomUUID(), mode: 'manual', amount_minor: amount, currency: course.currency,
      idempotency_key: randomUUID(), payment_method: dto.payment_method, payer_name: dto.payer_name.trim(), provider_ref: reference || null,
      payment_date: new Date(dto.payment_date), admin_remark: dto.notes?.trim() || null, receipt_public_id: asset?.public_id, receipt_resource_type: asset?.resource_type,
      receipt_url: asset?.secure_url, receipt_original_name: file?.originalname, receipt_mime_type: file?.mimetype, receipt_bytes: asset?.bytes,
    } });
  }
  async decideManual(actor: CurrentUser, id: string, approve: boolean, remark?: string) {
    return this.db.atomic(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id }, include: { course: true } });
      if (!payment) throw new NotFoundException('Payment not found');
      if (payment.mode !== 'manual') throw new ConflictException('Only manual payments use this review workflow');
      if (payment.status !== 'PENDING') return payment;
      if (approve && payment.provider_ref) {
        const duplicate = await tx.payment.findFirst({ where: { provider_ref: payment.provider_ref, status: 'SUCCEEDED', NOT: { id } } });
        if (duplicate) throw new ConflictException('This transaction reference has already been verified for another purchase');
      }
      const status = approve ? 'APPROVED' : 'REJECTED';
      const updated = await tx.payment.update({ where: { id, status: 'PENDING' }, data: { status, verified_at: new Date(), verified_by: actor.id, admin_remark: remark?.trim() || null } });
      if (!approve) return updated;
      const enrollment = await tx.enrollment.upsert({ where: { user_id_course_id: { user_id: payment.user_id, course_id: payment.course_id } }, update: { status: 'ACTIVE', payment_id: payment.id }, create: { user_id: payment.user_id, course_id: payment.course_id, payment_id: payment.id, status: 'ACTIVE' } });
      await tx.courseEntitlement.upsert({ where: { enrollment_id: enrollment.id }, update: { state: 'ACTIVE', revoked_at: null }, create: { enrollment_id: enrollment.id, state: 'ACTIVE' } });
      return updated;
    });
  }
  async receipt(user: CurrentUser, id: string) {
    const payment = await this.db.payment.findUnique({ where: { id }, select: { id: true, user_id: true, receipt_url: true, receipt_public_id: true, receipt_resource_type: true, receipt_original_name: true, receipt_mime_type: true } });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.user_id !== user.id && !['ADMIN', 'SUPER_ADMIN'].includes(user.role)) throw new ForbiddenException('Receipt access denied');
    return payment;
  }
  private async revokeEntitlements(
    tx: Prisma.TransactionClient,
    paymentId: string,
  ) {
    await tx.enrollment.updateMany({
      where: { payment_id: paymentId },
      data: { status: 'REVOKED' },
    });
    await tx.courseEntitlement.updateMany({
      where: { enrollment: { payment_id: paymentId } },
      data: { state: 'REVOKED', revoked_at: new Date() },
    });
  }
  async create(user: CurrentUser, dto: CreatePaymentDto) {
    if (user.role !== 'STUDENT')
      throw new ForbiddenException('Student account required');
    const claim = await this.db.atomic(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { auth_version: { increment: 1 } },
      });
      const course = await tx.course.findFirst({
        where: {
          id: dto.course_id,
          published: true,
          archived_at: null,
          visibility: 'PUBLIC',
        },
      });
      if (!course || course.price_minor <= 0)
        throw new ConflictException('Select a published paid course');
      const existing = await tx.enrollment.findUnique({
        where: {
          user_id_course_id: { user_id: user.id, course_id: course.id },
        },
      });
      if (existing)
        throw new ConflictException(
          existing.status === 'ACTIVE'
            ? 'You already own this course'
            : 'Access was revoked. Contact support.',
        );
      const prior = await tx.payment.findFirst({
        where: {
          user_id: user.id,
          OR: [
            { idempotency_key: dto.idempotency_key },
            { course_id: course.id, status: 'PENDING' },
          ],
        },
        orderBy: { created_at: 'desc' },
      });
      if (prior) {
        if (prior.course_id !== course.id)
          throw new ConflictException(
            'Idempotency key belongs to a different course',
          );
        if (!prior.checkout_url)
          throw new ConflictException(
            'Payment is processing. Check payment history or contact support.',
          );
        return { payment: prior, course, isNew: false };
      }
      const payment = await tx.payment.create({
        data: {
          user_id: user.id,
          course_id: course.id,
          tx_ref: 'freshman-' + randomUUID(),
          mode: process.env.CHAPA_MODE ?? 'test',
          amount_minor: course.price_minor,
          currency: course.currency,
          idempotency_key: dto.idempotency_key,
        },
      });
      return { payment, course, isNew: true };
    });
    if (!claim.isNew) return claim.payment;
    // Never put a provider call inside a retryable database transaction.
    const [first, ...last] = user.name.trim().split(/\s+/);
    const data = await this.gateway.initialize({
      amount: (claim.payment.amount_minor / 100).toFixed(2),
      currency: claim.payment.currency,
      email: user.email,
      first_name: first,
      last_name: last.join(' ') || first,
      tx_ref: claim.payment.tx_ref,
      callback_url:
        process.env.BACKEND_URL +
        '/api/v1/payments/callback?tx_ref=' +
        claim.payment.tx_ref,
      return_url:
        process.env.FRONTEND_URL +
        '/payments?reference=' +
        claim.payment.tx_ref,
      customization: {
        title: 'Learnova course',
        description: chapaDescription(claim.course.title),
      },
    }).catch(async (error: unknown) => {
      await this.db.payment.updateMany({ where: { id: claim.payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
      throw error;
    });
    const checkout = new URL(String(data.checkout_url));
    if (
      checkout.protocol !== 'https:' ||
      !['chapa.co', 'chapa.global'].some(
        (host) =>
          checkout.hostname === host || checkout.hostname.endsWith('.' + host),
      )
    )
      throw new BadGatewayException('Invalid provider checkout URL');
    return this.db.payment.update({
      where: { id: claim.payment.id },
      data: { checkout_url: checkout.href },
    });
  }
  async mine(user: CurrentUser) {
    const rows = await this.db.payment.findMany({
      where: { user_id: user.id },
      include: { course: { select: { title: true } } },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return rows.map(({ course, ...p }) => ({
      ...p,
      course_title: course.title,
    }));
  }
  async status(user: CurrentUser, reference: string) {
    const payment = await this.db.payment.findFirst({
      where: { tx_ref: reference, user_id: user.id },
      include: { refund: true },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (payment.refund) await this.verifyRefund(payment.id);
    if (payment.status === 'PENDING') await this.verify(reference);
    const result = await this.db.payment.findUniqueOrThrow({ where: { id: payment.id }, include: { course: { select: { title: true } } } });
    const { course, ...safe } = result;
    return { ...safe, course_title: course.title };
  }
  async verify(reference: string) {
    const payment = await this.db.payment.findUnique({
      where: { tx_ref: reference },
      include: {
        user: { select: { email: true } },
        course: { select: { title: true } },
      },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (['REVOKED', 'REFUNDED'].includes(payment.status))
      return { received: true };
    const data = await this.gateway.verify(reference);
    if (
      data.tx_ref !== reference ||
      minorUnits(data.amount) !== payment.amount_minor ||
      data.currency !== payment.currency ||
      String(data.email).toLowerCase() !== payment.user.email ||
      (data.mode && data.mode !== (payment.mode === 'unknown' ? (process.env.CHAPA_MODE ?? 'test') : payment.mode))
    )
      throw new BadGatewayException(
        'Payment verification did not match the order',
      );
    const status = String(data.status).toLowerCase();
    if (!['success', 'failed', 'cancelled', 'canceled', 'refunded'].includes(status))
      return { received: true };
    await this.db.atomic(async (tx) => {
      const current = await tx.payment.findUniqueOrThrow({
        where: { id: payment.id },
      });
      if (['REVOKED', 'REFUNDED'].includes(current.status)) return;
      if (status === 'success') {
        if (current.status === 'SUCCEEDED') return;
        const providerRef =
          typeof data.reference === 'string'
            ? data.reference
            : typeof data.ref_id === 'string'
              ? data.ref_id
              : '';
        if (!providerRef)
          throw new BadGatewayException('Gateway reference missing');
        await tx.payment.update({
          where: { id: current.id },
          data: { status: 'SUCCEEDED', provider_ref: providerRef, verified_at: new Date() },
        });
        await notify(tx, [current.user_id], { event_key: `payment:${current.id}:verified`, kind: 'PAYMENT', title: 'Payment verified', message: `Your payment for ${payment.course.title} was verified.`, href: `/payments?reference=${current.tx_ref}` });
        const previousEnrollment = await tx.enrollment.findUnique({
          where: {
            user_id_course_id: {
              user_id: current.user_id,
              course_id: current.course_id,
            },
          },
          select: { id: true },
        });
        const enrollment = await tx.enrollment.upsert({
          where: {
            user_id_course_id: {
              user_id: current.user_id,
              course_id: current.course_id,
            },
          },
          update: {},
          create: {
            user_id: current.user_id,
            course_id: current.course_id,
            payment_id: current.id,
          },
        });
        await tx.courseEntitlement.upsert({
          where: { enrollment_id: enrollment.id },
          update: {},
          create: {
            enrollment_id: enrollment.id,
            state: enrollment.status === 'ACTIVE' ? 'ACTIVE' : 'REVOKED',
          },
        });
        await audit(tx, {
          target: current.user_id,
          action: 'PAYMENT_VERIFIED',
          description: `Course payment verified by Chapa: ${payment.course.title}.`,
          resourceType: 'PAYMENT',
          resourceId: current.id,
          oldValues: { status: current.status },
          newValues: {
            status: 'SUCCEEDED',
            reference: current.tx_ref,
            course_id: current.course_id,
            amount_minor: current.amount_minor,
            currency: current.currency,
          },
        });
        if (!previousEnrollment)
          await audit(tx, {
            target: current.user_id,
            action: 'COURSE_ENROLLED',
            description: 'Student enrolled after verified payment.',
            resourceType: 'COURSE',
            resourceId: current.course_id,
          });
      } else if (status === 'refunded') {
        await tx.payment.update({
          where: { id: current.id },
          data: { status: 'REFUNDED' },
        });
        await this.revokeEntitlements(tx, current.id);
      } else if (current.status === 'PENDING')
        await tx.payment.update({
          where: { id: current.id },
          data: { status: 'FAILED' },
        });
    });
    return { received: true };
  }
  async webhook(
    raw: Buffer,
    signature: string | undefined,
    legacy: string | undefined,
    body: Record<string, unknown>,
  ) {
    if (!validWebhook(raw, signature, legacy, process.env.CHAPA_WEBHOOK_SECRET))
      throw new UnauthorizedException('Invalid webhook signature');
    const type =
      typeof body.event === 'string'
        ? body.event
        : typeof body.webhook_type === 'string'
          ? body.webhook_type
          : '';
    const reference =
      typeof body.tx_ref === 'string'
        ? body.tx_ref
        : typeof body.trx_ref === 'string'
          ? body.trx_ref
          : '';
    if (type.toLowerCase().includes('refund')) {
      const ref = typeof body.ref_id === 'string' ? body.ref_id : '';
      const refund = await this.db.refund.findFirst({
        where: {
          OR: [{ provider_ref: ref }, { payment: { tx_ref: reference } }],
        },
      });
      if (refund) return this.verifyRefund(refund.payment_id);
    }
    if (!/^freshman-[a-f0-9-]{36}$/.test(reference))
      throw new NotFoundException('Unknown transaction');
    return this.verify(reference);
  }
  async review() {
    const rows = await this.db.payment.findMany({
      include: {
        user: { select: { email: true } },
        course: { select: { title: true } },
        refund: { select: { status: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });
    return rows.map(({ user, course, refund, ...p }) => ({
      ...p,
      email: user.email,
      course_title: course.title,
      refund_status: refund?.status ?? null,
    }));
  }
  revoke(actor: CurrentUser, id: string, reason: string) {
    return this.db.atomic(async (tx) => {
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment) throw new NotFoundException();
      await tx.payment.update({ where: { id }, data: { status: 'REVOKED' } });
      await this.revokeEntitlements(tx, id);
      await audit(tx, {
        actor,
        target: payment.user_id,
        action: 'ACCESS_REVOKED',
        description: 'Course access associated with the payment was revoked.',
        resourceType: 'PAYMENT',
        resourceId: id,
        reason,
        oldValues: { payment_status: payment.status },
        newValues: { payment_status: 'REVOKED' },
      });
      return {
        message: 'Access revoked. This does not issue a monetary refund.',
      };
    });
  }
  async requestRefund(actor: CurrentUser, id: string, reason: string) {
    const claim = await this.db.atomic(async (tx) => {
      const payment = await tx.payment.findUnique({
        where: { id },
        include: { refund: true },
      });
      if (!payment) throw new NotFoundException();
      if (payment.refund)
        return { refund: payment.refund, payment, isNew: false };
      if (payment.status !== 'SUCCEEDED')
        throw new ConflictException(
          'Only a successful payment can be refunded',
        );
      const refund = await tx.refund.create({
        data: {
          payment_id: id,
          reference: 'refund-' + randomUUID(),
          actor_id: actor.id,
          reason,
        },
      });
      await tx.payment.update({ where: { id }, data: { status: 'REVOKED' } });
      await this.revokeEntitlements(tx, id);
      await audit(tx, {
        actor,
        target: payment.user_id,
        action: 'REFUND_REQUESTED',
        description:
          'A payment refund was requested and course access was revoked.',
        resourceType: 'PAYMENT',
        resourceId: id,
        reason,
      });
      return { refund, payment, isNew: true };
    });
    if (!claim.isNew)
      return claim.refund.provider_ref
        ? this.verifyRefund(id)
        : {
            status: claim.refund.status,
            message:
              'A refund request already exists. Reconcile uncertain money movement with Chapa support.',
          };
    try {
      const data = await this.gateway.refund(
        claim.payment.provider_ref!,
        reason,
        claim.refund.reference,
      );
      if (typeof data.ref_id !== 'string')
        throw new BadGatewayException('Refund reference missing from provider');
      await this.db.refund.update({
        where: { id: claim.refund.id },
        data: { provider_ref: data.ref_id, status: 'PROCESSING' },
      });
      return {
        status: 'PROCESSING',
        message:
          'Full refund requested. Access is revoked while the provider processes it.',
      };
    } catch (error) {
      await this.db.refund.update({
        where: { id: claim.refund.id },
        data: { status: 'UNKNOWN' },
      });
      throw error;
    }
  }
  async verifyRefund(paymentId: string) {
    const refund = await this.db.refund.findUnique({
      where: { payment_id: paymentId },
      include: { payment: true },
    });
    if (!refund) throw new NotFoundException('No refund request exists');
    if (!refund.provider_ref || refund.status === 'REFUNDED')
      return { status: refund.status };
    const data = await this.gateway.verifyRefund(refund.provider_ref);
    if (
      data.ref_id !== refund.provider_ref ||
      data.payment_reference !== refund.payment.provider_ref ||
      minorUnits(data.amount) !== refund.payment.amount_minor ||
      data.currency !== refund.payment.currency
    )
      throw new BadGatewayException(
        'Refund verification did not match this payment',
      );
    const status = String(data.status).toLowerCase(),
      next =
        status === 'refunded'
          ? 'REFUNDED'
          : status === 'reversed'
            ? 'REVERSED'
            : 'PROCESSING';
    return this.db.atomic(async (tx) => {
      const current = await tx.refund.findUniqueOrThrow({
        where: { id: refund.id },
      });
      if (current.status === 'REFUNDED') return { status: current.status };
      await tx.refund.update({
        where: { id: refund.id },
        data: { status: next },
      });
      if (next === 'REFUNDED')
        await tx.payment.update({
          where: { id: paymentId },
          data: { status: 'REFUNDED' },
        });
      await this.revokeEntitlements(tx, paymentId);
      return { status: next };
    });
  }
}
