import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { minorUnits } from './chapa.gateway.js';
import { validWebhook } from './payments.service.js';
import { hasPermission } from '../roles/permissions.js';
describe('payment security', () => {
  it('uses exact minor-unit conversion', () => {
    expect(minorUnits('123.45')).toBe(12345);
    expect(minorUnits('9.1')).toBe(910);
    expect(() => minorUnits('1.001')).toThrow();
    expect(() => minorUnits('NaN')).toThrow();
  });
  it('authenticates the exact webhook payload', () => {
    const raw = Buffer.from('{"tx_ref":"payment"}'),
      secret = 'test-secret';
    const signature = createHmac('sha256', secret).update(raw).digest('hex');
    expect(validWebhook(raw, signature, undefined, secret)).toBe(true);
    expect(validWebhook(Buffer.from('{}'), signature, undefined, secret)).toBe(
      false,
    );
    expect(validWebhook(raw, 'bad', undefined, secret)).toBe(false);
  });
  it('enforces the role permission matrix', () => {
    expect(hasPermission('STUDENT', 'courses:write')).toBe(false);
    expect(hasPermission('INSTRUCTOR', 'courses:write')).toBe(true);
    expect(hasPermission('INSTRUCTOR', 'devices:reset')).toBe(false);
    expect(hasPermission('ADMIN', 'roles:manage')).toBe(false);
    expect(hasPermission('SUPER_ADMIN', 'roles:manage')).toBe(true);
  });
});
