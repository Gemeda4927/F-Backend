import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
@Injectable()
export class MailService {
  requireConfiguration() {
    if (!process.env.SMTP_HOST || !process.env.MAIL_FROM)
      throw new ServiceUnavailableException(
        'Password recovery email is not configured. Contact support.',
      );
  }
  async sendReset(email: string, token: string) {
    this.requireConfiguration();
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
        : undefined,
    });
    const url = new URL('/reset-password', process.env.FRONTEND_URL);
    url.searchParams.set('token', token);
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Reset your Freshman password',
      text: `Use this link within 30 minutes to reset your password: ${url}\nIf you did not request this, ignore this message. Resetting also signs out registered devices.`,
    });
  }
}
