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
    {
      email: 'gemedaforwork@gmail.com',
      name: 'Gemeda For Work',
      role: 'INSTRUCTOR',
    },
  ];
  await db.$transaction(
    async (tx) => {
      for (const account of accounts) {
        const existing = await tx.user.findUnique({
          where: { email: account.email },
        });
        if (existing) {
          if (
            account.email === 'gemedaforwork@gmail.com' &&
            existing.role !== account.role
          ) {
            await tx.user.update({
              where: { id: existing.id },
              data: {
                role: account.role,
                role_id: account.role,
                auth_version: { increment: 1 },
              },
            });
            await tx.authSession.updateMany({
              where: { user_id: existing.id, revoked_at: null },
              data: { revoked_at: new Date() },
            });
            await tx.fcmToken.deleteMany({ where: { user_id: existing.id } });
            console.log('Updated instructor account: ' + account.email);
          } else if (existing.role !== account.role)
            throw Error('Existing account role mismatch: ' + account.email);
          continue;
        }
        await tx.user.create({
          data: { ...account, role_id: account.role, password_hash },
        });
      }
      const ownerEmail = 'gemedatam@gmail.com';
      const owner = await tx.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
      if (owner) {
        const conflicting = await tx.user.findUnique({ where: { email: ownerEmail } });
        if (conflicting && conflicting.id !== owner.id) {
          await tx.user.update({
            where: { id: owner.id },
            data: { role: 'ADMIN', role_id: 'ADMIN', auth_version: { increment: 1 } },
          });
          await tx.authSession.updateMany({ where: { user_id: owner.id, revoked_at: null }, data: { revoked_at: new Date() } });
          await tx.fcmToken.deleteMany({ where: { user_id: owner.id } });
          await tx.user.update({
            where: { id: conflicting.id },
            data: {
              name: 'Learnova Super Admin',
              role: 'SUPER_ADMIN',
              role_id: 'SUPER_ADMIN',
              password_hash,
              auth_version: { increment: 1 },
            },
          });
          await tx.authSession.updateMany({ where: { user_id: conflicting.id, revoked_at: null }, data: { revoked_at: new Date() } });
          await tx.fcmToken.deleteMany({ where: { user_id: conflicting.id } });
          console.log('Transferred Super Admin to existing account: ' + ownerEmail);
          return;
        }
        await tx.user.update({
          where: { id: owner.id },
          data: {
            email: ownerEmail,
            name: 'Learnova Super Admin',
            password_hash,
            auth_version: { increment: 1 },
          },
        });
        await tx.authSession.updateMany({ where: { user_id: owner.id, revoked_at: null }, data: { revoked_at: new Date() } });
        await tx.fcmToken.deleteMany({ where: { user_id: owner.id } });
        console.log('Updated Super Admin: ' + ownerEmail);
      } else {
        await tx.user.create({
          data: {
            email: ownerEmail,
            name: 'Learnova Super Admin',
            role: 'SUPER_ADMIN',
            role_id: 'SUPER_ADMIN',
            password_hash,
          },
        });
        console.log('Created Super Admin: ' + ownerEmail);
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
