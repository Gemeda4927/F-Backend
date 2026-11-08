import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ChapaGateway,
  chapaDescription,
  chapaFailureReason,
} from './chapa.gateway.js';
describe('Chapa provider errors', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  function response(status: number, body: unknown) {
    vi.stubEnv('CHAPA_SECRET_KEY', 'CHASECK_TEST-unit');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
    );
  }
  it('explains email validation without exposing the provider body', async () => {
    response(400, { message: { email: ['private@example.com rejected'] } });
    await expect(new ChapaGateway().initialize({})).rejects.toThrow(
      'Chapa rejected your account email',
    );
  });
  it('distinguishes authentication failures', async () => {
    response(401, { message: 'secret provider detail' });
    await expect(new ChapaGateway().initialize({})).rejects.toThrow(
      'could not be authenticated',
    );
  });
  it('handles network failures safely', async () => {
    vi.stubEnv('CHAPA_SECRET_KEY', 'CHASECK_TEST-unit');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret')));
    await expect(new ChapaGateway().initialize({})).rejects.toThrow(
      'Unable to reach Chapa',
    );
  });
  it('returns a successful checkout response', async () => {
    response(200, {
      status: 'success',
      data: { checkout_url: 'https://checkout.chapa.co/test' },
    });
    await expect(new ChapaGateway().initialize({})).resolves.toEqual({
      checkout_url: 'https://checkout.chapa.co/test',
    });
  });
});

it('formats course titles for the Chapa v1 description constraint', () => {
  expect(chapaDescription('CoC ? Health & Science: Introduction!')).toBe(
    'CoC Health Science Introduction',
  );
  expect(chapaDescription('###')).toBe('Course enrollment');
  expect(chapaDescription('a'.repeat(80))).toHaveLength(50);
});

describe('safe Chapa message classification', () => {
  it.each([
    ['Invalid API Key or User does not exist', 'AUTHENTICATION_REJECTED'],
    ['User can?t receive payments', 'MERCHANT_PAYMENTS_DISABLED'],
    [
      'Payments through API is disabled, please contact us',
      'MERCHANT_PAYMENTS_DISABLED',
    ],
    ['Invalid currency, currency is not supported', 'CURRENCY_UNSUPPORTED'],
    ['Transaction reference has been used before', 'REFERENCE_ALREADY_USED'],
    ['private@example.com CHASECK_TEST-private-data', 'UNCLASSIFIED'],
    [{ email: ['private@example.com'] }, 'UNCLASSIFIED'],
  ])('returns a fixed safe reason', (message, reason) => {
    expect(chapaFailureReason(message)).toBe(reason);
  });
  it('never returns raw provider text', () => {
    expect(chapaFailureReason('Invalid API Key CHASECK_TEST-private')).toBe(
      'AUTHENTICATION_REJECTED',
    );
  });
});
