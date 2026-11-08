import { gracefulExit } from 'exit-hook';
import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
const testRoot = resolve(tmpdir());
const directory = resolve(testRoot, 'freshman-test-postgres-' + randomUUID());
if (
  !directory.startsWith(testRoot + sep) ||
  !directory.slice(testRoot.length + 1).startsWith('freshman-test-postgres-')
)
  throw Error('Unsafe test database directory');
const port = await new Promise((done, reject) => {
  const s = createServer();
  s.on('error', reject);
  s.listen(0, '127.0.0.1', () => {
    const value = s.address().port;
    s.close(() => done(value));
  });
});
const password = randomBytes(24).toString('hex');
const server = new EmbeddedPostgres({
  databaseDir: directory,
  port,
  user: 'freshman_test',
  password,
  persistent: true,
  autoRehydrateSymlinks: true,
  onLog: () => {},
  onError: console.error,
});
function run(args, env) {
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, args, {
      stdio: 'inherit',
      env: { ...process.env, ...env },
    });
    child.once('error', reject);
    child.once('exit', (code) =>
      code === 0
        ? done()
        : reject(Error('Test command failed with exit ' + code)),
    );
  });
}
try {
  await server.initialise();
  await server.start();
  await server.createDatabase('freshman_test_platform');
  const url =
    'postgresql://freshman_test:' +
    password +
    '@127.0.0.1:' +
    port +
    '/freshman_test_platform';
  // Prisma prefers DIRECT_URL over DATABASE_URL. Override both, so migrations
  // can never escape the isolated test cluster via a developer's .env file.
  const env = {
    DATABASE_URL: url,
    DIRECT_URL: url,
    SHADOW_DATABASE_URL: '',
    TEST_DATABASE_URL: url,
  };
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy'], env);
  await run(
    [
      'node_modules/vitest/vitest.mjs',
      'run',
      '--config',
      'vitest.config.e2e.ts',
    ],
    env,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await server.stop();
  // OneDrive and Windows process shutdown can briefly lock database files.
  if (!directory.startsWith(testRoot + sep))
    throw Error('Unsafe cleanup directory');
  await rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 300,
  });
}
gracefulExit(process.exitCode ?? 0);
