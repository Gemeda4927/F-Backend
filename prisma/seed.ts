import {
  PrismaClient,
  RoleName,
  PermissionScope,
} from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  hasPermission,
  type Permission,
} from '../src/modules/roles/permissions.js';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
export async function seedConfiguration(db: PrismaClient) {
  // Establish the connection and wake Neon before starting a timed transaction.
  await db.$connect();
  await db.role.findFirst({ select: { id: true } });
  const permissions: Permission[] = [
    'users:manage',
    'roles:manage',
    'devices:reset',
    'courses:write',
    'payments:review',
    'payments:refund',
    'access:revoke',
  ];
  await db.$transaction(
    async (tx) => {
      for (const code of permissions) {
        const scope =
          code.startsWith('payments:') || code.startsWith('access:')
            ? PermissionScope.BILLING
            : code.startsWith('courses:')
              ? PermissionScope.LEARNING
              : PermissionScope.ACCOUNTS;
        await tx.permission.upsert({
          where: { code },
          update: {},
          create: { code, scope, description: code.replace(':', ' ') },
        });
      }
      for (const role of Object.values(RoleName)) {
        const existing = await tx.role.findUnique({ where: { id: role } });
        if (!existing)
          await tx.role.create({
            data: {
              id: role,
              name: role,
              permissions: {
                create: permissions
                  .filter((p) => hasPermission(role, p))
                  .map((permission_code) => ({ permission_code })),
              },
            },
          });
        await tx.user.updateMany({
          where: { role, role_id: null },
          data: { role_id: role },
        });
      }
    },
    { maxWait: 30000, timeout: 120000 },
  );
  // Backfill missing entitlements only; never restore a revoked grant or modify purchases.
  let cursor: string | undefined;
  for (;;) {
    const rows = await db.enrollment.findMany({
      take: 250,
      orderBy: { id: 'asc' },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { payment: true },
    });
    if (!rows.length) break;
    await db.$transaction(
      rows.map((row) =>
        db.courseEntitlement.upsert({
          where: { enrollment_id: row.id },
          update: {},
          create: {
            enrollment_id: row.id,
            state:
              row.status === 'ACTIVE' &&
              (!row.payment_id || row.payment?.status === 'SUCCEEDED')
                ? 'ACTIVE'
                : 'REVOKED',
            granted_at: row.created_at,
            ...(row.status === 'REVOKED' ||
            (row.payment_id && row.payment?.status !== 'SUCCEEDED')
              ? { revoked_at: new Date() }
              : {}),
          },
        }),
      ),
    );
    cursor = rows.at(-1)!.id;
  }
}
async function main() {
  if (existsSync('.env')) loadEnvFile('.env');
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required');
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: process.env.DIRECT_URL || process.env.DATABASE_URL,
      connectionTimeoutMillis: 30000,
      ssl:
        process.env.DATABASE_SSL === 'true'
          ? { rejectUnauthorized: true }
          : undefined,
    }),
  });
  try {
    await seedConfiguration(db);
    const email = process.env.BOOTSTRAP_EMAIL,
      password = process.env.BOOTSTRAP_PASSWORD;
    if (email || password) {
      if (
        !email ||
        !password ||
        password.length < 12 ||
        Buffer.byteLength(password) > 72
      )
        throw Error(
          'Set both bootstrap variables, with a password of 12+ characters and at most 72 UTF-8 bytes',
        );
      const password_hash = await bcrypt.hash(password, 12);
      await db.$transaction(
        async (tx) => {
          if (await tx.user.findFirst({ where: { role: 'SUPER_ADMIN' } }))
            throw Error('Super Admin already exists; no account was changed');
          await tx.user.create({
            data: {
              email: email.toLowerCase().trim(),
              name: 'Platform owner',
              role: 'SUPER_ADMIN',
              role_id: 'SUPER_ADMIN',
              password_hash,
            },
          });
        },
        { isolationLevel: 'Serializable', maxWait: 30000, timeout: 120000 },
      );
      console.log(
        'Created the platform owner. Remove bootstrap credentials from the environment.',
      );
    }
    console.log(
      'Role/permission configuration and missing entitlement backfill complete.',
    );
  } finally {
    await db.$disconnect();
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await main();
