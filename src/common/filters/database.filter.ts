import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { Prisma } from '../../generated/prisma/client.js';
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
        ? 'This record conflicts with existing data.'
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
