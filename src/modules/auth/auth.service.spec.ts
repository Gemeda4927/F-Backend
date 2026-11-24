import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from './auth.service.js';

describe('AuthService password recovery', () => {
  const mail = { requireConfiguration: vi.fn(), sendReset: vi.fn() };
  const user = { id: 'user-1', email: 'student@example.com' };
  let db: any;
  let tx: any;
  let service: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    tx = {
      passwordResetToken: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
        findFirst: vi.fn().mockResolvedValue({
          id: 'reset-1', user_id: user.id, token_hash: 'hash',
        }),
      },
      user: { update: vi.fn().mockResolvedValue({}) },
      authSession: { updateMany: vi.fn().mockResolvedValue({}) },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
    };
    db = {
      user: { findFirst: vi.fn().mockResolvedValue(user) },
      passwordResetToken: { findFirst: vi.fn() },
      atomic: vi.fn(async (callback: (transaction: any) => unknown) => callback(tx)),
    };
    service = new AuthService(db, mail as any);
  });

  it('creates a hashed token with a 15 minute lifetime and sends recovery mail', async () => {
    const before = Date.now();
    await service.forgot(user.email);
    const created = tx.passwordResetToken.create.mock.calls[0][0].data;
    expect(created.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(created.expires_at.getTime()).toBeGreaterThanOrEqual(before + 14 * 60000);
    expect(created.expires_at.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60000);
    expect(mail.sendReset).toHaveBeenCalledWith(user.email, expect.any(String));
  });

  it('rejects a token that another concurrent request already claimed', async () => {
    tx.passwordResetToken.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.reset({ token: 'a'.repeat(64), password: 'A secure password 123!' }))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(tx.user.update).not.toHaveBeenCalled();
  });
});
