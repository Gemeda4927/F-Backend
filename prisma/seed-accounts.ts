import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import bcrypt from 'bcryptjs';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { seedConfiguration } from './seed.js';

if (existsSync('.env')) loadEnvFile('.env');
const password = process.env.SEED_ACCOUNT_PASSWORD;
if (!password || password.length < 12 || Buffer.byteLength(password) > 72)
  throw Error(
    'Set SEED_ACCOUNT_PASSWORD to 12+ characters, at most 72 UTF-8 bytes',
  );
if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
const db = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
    connectionTimeoutMillis: 30000,
  }),
});
try {
  await seedConfiguration(db);
  const password_hash = await bcrypt.hash(password, 12);
  const accounts = [
    ...Array.from({ length: 10 }, (_, i) => ({
      email: 'student' + (i + 1) + '@learnova.example',
      name: 'Student ' + (i + 1),
      role: 'STUDENT',
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      email: 'instructor' + (i + 1) + '@learnova.example',
      name: 'Instructor ' + (i + 1),
      role: 'INSTRUCTOR',
    })),
  ];
  await db.$transaction(
    async (tx) => {
      for (const account of accounts) {
        const existing = await tx.user.findUnique({
          where: { email: account.email },
        });
        if (existing) {
          if (existing.role !== account.role)
            throw Error('Existing account role mismatch: ' + account.email);
          continue;
        }
        await tx.user.create({
          data: { ...account, role_id: account.role, password_hash },
        });
      }
      const owner = await tx.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
      if (owner) console.log('Existing Super Admin retained: ' + owner.email);
      else {
        const email = 'superadmin@learnova.example';
        if (await tx.user.findUnique({ where: { email } }))
          throw Error('Owner email already belongs to another account');
        await tx.user.create({
          data: {
            email,
            name: 'Learnova Super Admin',
            role: 'SUPER_ADMIN',
            role_id: 'SUPER_ADMIN',
            password_hash,
          },
        });
        console.log('Created Super Admin: ' + email);
      }
    },
    { isolationLevel: 'Serializable', maxWait: 30000, timeout: 120000 },
  );
  console.log(
    '10 student and 5 instructor seed accounts are ready. Existing passwords were preserved.',
  );
} finally {
  await db.$disconnect();
}
