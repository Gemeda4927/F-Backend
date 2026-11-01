import { loadEnvFile } from 'node:process';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
loadEnvFile('.env');
if (process.env.APP_ENV === 'production') throw new Error('Test course cannot be seeded in production');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 30000 }) });
try {
  const instructor = await db.user.findUnique({ where: { email: 'instructor1@learnova.example' }, select: { id: true, role: true, active: true } });
  if (!instructor || instructor.role !== 'INSTRUCTOR' || !instructor.active) throw new Error('Active sample instructor instructor1@learnova.example was not found; no course was created.');
  const existing = await db.course.findFirst({ where: { instructor_id: instructor.id, title: 'Critical Thinking' }, select: { id: true } });
  if (existing) console.log('Critical Thinking already exists for the sample instructor.');
  else {
    await db.course.create({ data: { instructor_id: instructor.id, title: 'Critical Thinking', description: 'Practice evaluating evidence, recognizing assumptions, and making well-reasoned decisions.', category: 'Personal development', price_minor: 0, currency: 'ETB', published: false, lessons: { create: [{ title: 'Introduction to critical thinking', position: 0, kind: 'TEXT', preview: true, content: 'Critical thinking is the practice of examining claims, questioning assumptions, and evaluating evidence before reaching a conclusion.' }] } } });
    console.log('Created draft Critical Thinking course with an introductory lesson for instructor1@learnova.example.');
  }
} finally { await db.$disconnect(); }
