import { it, expect, afterEach } from 'vitest';
import { encryptPushToken, decryptPushToken, tokenHash } from './push-token.js';
const original = process.env.PUSH_TOKEN_ENCRYPTION_KEY;
afterEach(() => {
  if (original === undefined) delete process.env.PUSH_TOKEN_ENCRYPTION_KEY;
  else process.env.PUSH_TOKEN_ENCRYPTION_KEY = original;
});
it('encrypts push tokens with randomized authenticated ciphertext', () => {
  process.env.PUSH_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  const token = 'private-fcm-token-example',
    first = encryptPushToken(token),
    second = encryptPushToken(token);
  expect(first).not.toContain(token);
  expect(first).not.toBe(second);
  expect(decryptPushToken(first)).toBe(token);
  const parts = first.split('.');
  parts[1] = Buffer.alloc(16).toString('base64url');
  expect(() => decryptPushToken(parts.join('.'))).toThrow();
  expect(tokenHash(token)).toHaveLength(64);
});
it('rejects missing or invalid token-encryption keys', () => {
  delete process.env.PUSH_TOKEN_ENCRYPTION_KEY;
  expect(() => encryptPushToken('token')).toThrow();
  process.env.PUSH_TOKEN_ENCRYPTION_KEY = 'invalid';
  expect(() => encryptPushToken('token')).toThrow();
});
