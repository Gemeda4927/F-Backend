import { afterEach, describe, expect, it, vi } from 'vitest';
import { getConfiguration } from './configuration.js';

afterEach(() => vi.unstubAllEnvs());

function configure(port: string, origins = 'http://localhost:3000') {
  vi.stubEnv('PORT', port);
  vi.stubEnv('CORS_ORIGINS', origins);
  vi.stubEnv('OBSERVE_APP_KEY', '');
  vi.stubEnv('OBSERVE_APP_SECRET', '');
}

describe('runtime configuration', () => {
  it('accepts a port and trims multiple browser origins', () => {
    configure('3001', 'http://localhost:3000, https://example.com ');
    expect(getConfiguration()).toEqual({
      port: 3001,
      corsOrigins: ['http://localhost:3000', 'https://example.com'],
    });
  });

  it.each(['0', '65536', '3001.5', 'invalid'])(
    'rejects invalid port %s',
    (port) => {
      configure(port);
      expect(() => getConfiguration()).toThrow('PORT');
    },
  );

  it.each(['*', 'https://example.com/path', 'ftp://example.com'])(
    'rejects invalid browser origin %s',
    (origin) => {
      configure('3001', origin);
      expect(() => getConfiguration()).toThrow();
    },
  );

  it('rejects incomplete telemetry credentials', () => {
    configure('3001');
    vi.stubEnv('OBSERVE_APP_KEY', 'test-key');
    expect(() => getConfiguration()).toThrow('Set both');
  });
});
