import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import nodemailer from 'nodemailer';
const escapeHtml = (value: string) =>
  value.replace(/[&<>'\"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]!);
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
    const resetUrl = url.toString();
    await transport.sendMail({
      from: process.env.MAIL_FROM,
      to: email,
      subject: 'Reset your Freshman password',
      text: `Use this link within 15 minutes to reset your password: ${resetUrl}\nIf you did not request this, ignore this message. Resetting also signs out registered devices.`,
      html: `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a"><div style="max-width:560px;margin:32px auto;padding:32px 24px;background:#fff;border:1px solid #e2e8f0;border-radius:16px"><p style="margin:0 0 24px;font-weight:700;letter-spacing:.08em">LEARNOVA</p><h1 style="font-size:24px;margin:0 0 12px">Reset your password</h1><p style="line-height:1.6;color:#475569">We received a request to reset the password for ${escapeHtml(email)}. This link expires in 15 minutes and can only be used once.</p><p style="margin:28px 0"><a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:13px 20px;background:#dc2626;color:#fff;text-decoration:none;border-radius:10px;font-weight:700">Create a new password</a></p><p style="line-height:1.6;color:#64748b;font-size:13px">If you did not request this, you can safely ignore this email. Resetting your password signs out existing sessions and registered devices.</p></div></body></html>`,
    });
  }
}
