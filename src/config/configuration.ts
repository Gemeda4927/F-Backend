export function getConfiguration() {
  const port = Number(process.env.PORT ?? 5000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  const corsOrigins = (
    process.env.CORS_ORIGINS ??
    process.env.FRONTEND_URL ??
    'http://localhost:3000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  for (const origin of corsOrigins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS must contain comma-separated HTTP origins');
    }
  }
  if (
    Boolean(process.env.OBSERVE_APP_KEY) !==
    Boolean(process.env.OBSERVE_APP_SECRET)
  ) {
    throw new Error(
      'Set both OBSERVE_APP_KEY and OBSERVE_APP_SECRET, or neither',
    );
  }
  return { port, corsOrigins };
}

export function validatePlatformEnvironment() {
  for (const name of [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'FRONTEND_URL',
    'BACKEND_URL',
  ]) {
    if (!process.env[name]) throw new Error(name + ' is required');
  }
  for (const name of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) {
    if (
      process.env[name]!.length < 32 ||
      process.env[name]!.includes('replace_')
    )
      throw new Error(
        name + ' must contain a random secret of at least 32 characters',
      );
  }
  if (process.env.JWT_ACCESS_SECRET === process.env.JWT_REFRESH_SECRET)
    throw new Error('Use distinct JWT secrets');
  if (
    !['postgres:', 'postgresql:'].includes(
      new URL(process.env.DATABASE_URL!).protocol,
    )
  )
    throw new Error('DATABASE_URL must point to PostgreSQL');
  for (const name of ['FRONTEND_URL', 'BACKEND_URL']) {
    const url = new URL(process.env[name]!);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.origin !== process.env[name]
    )
      throw new Error(
        name + ' must be an HTTP origin without a trailing slash',
      );
  }
  if (
    process.env.COOKIE_SAME_SITE === 'none' &&
    process.env.COOKIE_SECURE !== 'true'
  )
    throw new Error('SameSite=None requires secure cookies');
  if (
    (process.env.APP_ENV ?? process.env.NODE_ENV) === 'production' &&
    (process.env.COOKIE_SECURE !== 'true' ||
      !process.env.FRONTEND_URL!.startsWith('https:'))
  )
    throw new Error('Production requires HTTPS and secure cookies');
  const mode = process.env.CHAPA_MODE ?? 'test';
  if (!['test', 'live'].includes(mode))
    throw new Error('CHAPA_MODE must be test or live');
  if (mode === 'live' && process.env.CHAPA_ALLOW_LIVE !== 'true')
    throw new Error('Live payments require explicit CHAPA_ALLOW_LIVE=true');
  if (
    process.env.CHAPA_SECRET_KEY &&
    ((mode === 'test' &&
      !process.env.CHAPA_SECRET_KEY.startsWith('CHASECK_TEST-')) ||
      (mode === 'live' && !process.env.CHAPA_SECRET_KEY.startsWith('CHASECK-')))
  )
    throw new Error('Chapa key does not match the configured mode');
  if (
    process.env.FIREBASE_PUSH_ENABLED === 'true' &&
    (!process.env.FIREBASE_PROJECT_ID ||
      !/^[a-f0-9]{64}$/i.test(process.env.PUSH_TOKEN_ENCRYPTION_KEY ?? ''))
  )
    throw new Error(
      'Firebase push requires project ID and a 64-character hex token encryption key',
    );
}
