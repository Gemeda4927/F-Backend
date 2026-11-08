import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from 'node:crypto';
export const tokenHash = (text: string) =>
  createHash('sha256').update(text).digest('hex');
function key() {
  const value = process.env.PUSH_TOKEN_ENCRYPTION_KEY ?? '';
  if (!/^[a-f0-9]{64}$/i.test(value))
    throw new Error('Configure PUSH_TOKEN_ENCRYPTION_KEY as 64 hex characters');
  return Buffer.from(value, 'hex');
}
export function encryptPushToken(token: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data]
    .map((x) => x.toString('base64url'))
    .join('.');
}
export function decryptPushToken(value: string) {
  const [iv, tag, data] = value
    .split('.')
    .map((x) => Buffer.from(x, 'base64url'));
  const cipher = createDecipheriv('aes-256-gcm', key(), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
