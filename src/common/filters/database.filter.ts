import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
// Use schema metadata only; never expose database messages, SQL, or conflicting values.
function constraintNames(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return [];
  if (typeof value === 'string') return [value];
  if (Array.isArray(value))
    return value.flatMap((v) => constraintNames(v, depth + 1));
  if (typeof value !== 'object') return [];
  return Object.entries(value)
    .filter(([key]) =>
      [
        'modelName',
        'target',
        'driverAdapterError',
        'cause',
        'constraint',
        'fields',
        'index',
      ].includes(key),
    )
    .flatMap(([, v]) => constraintNames(v, depth + 1));
}
export function conflictMessage(code: string, meta?: unknown) {
  if (code === 'P2003')
    return 'The related course or item has changed. Refresh the page and try again.';
  const names = constraintNames(meta).join(' ').toLowerCase();
  if (
    names.includes('position') &&
    (names.includes('lesson') || names.includes('course_id'))
  )
    return 'This content order is already used in this course. Choose a different order and save again.';
  if (names.includes('email'))
    return 'An account with this email already exists. Sign in or use another email address.';
  if (names.includes('device') || names.includes('one_registered_device'))
    return 'This account already has a registered device. Use that device or ask an administrator to reset it.';
  if (names.includes('enrollment'))
    return 'You are already enrolled in this course. Open My learning to continue.';
  if (
    names.includes('assessmentattempt') ||
    names.includes('assessment_attempt')
  )
    return 'An exam attempt already exists. Refresh the exam to continue.';
  if (names.includes('payment'))
    return 'This payment request already exists. Check Payments before trying again.';
  return 'An item with these details already exists. Refresh the page or use different details.';
}
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class DatabaseFilter implements ExceptionFilter {
  catch(error: Error, host: ArgumentsHost) {
    const code =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? error.code
        : 'VALIDATION';
    const status =
      code === 'P2002'
        ? 409
        : code === 'P2025'
          ? 404
          : code === 'P2003'
            ? 409
            : code === 'VALIDATION'
              ? 400
              : 500;
    const message =
      status === 409
        ? conflictMessage(
            code,
            error instanceof Prisma.PrismaClientKnownRequestError
              ? error.meta
              : undefined,
          )
        : status === 404
          ? 'Record not found.'
          : status === 400
            ? 'Invalid database request.'
            : 'The database could not complete the request.';
    host
      .switchToHttp()
      .getResponse<Response>()
      .status(status)
      .json({ statusCode: status, message });
  }
}
