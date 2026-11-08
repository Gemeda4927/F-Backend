import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChapaGateway, chapaDescription } from './chapa.gateway.js';
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
