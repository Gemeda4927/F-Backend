import { NoStoreInterceptor } from './common/interceptors/no-store.interceptor.js';
import { loadEnvFile } from 'node:process';
import { existsSync } from 'node:fs';
import { NestFactory } from '@nestjs/core';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import {
  getConfiguration,
  validatePlatformEnvironment,
} from './config/configuration.js';
import { DatabaseFilter } from './common/filters/database.filter.js';
async function bootstrap() {
  if (existsSync('.env')) loadEnvFile('.env');
  validatePlatformEnvironment();
  const config = getConfiguration();
  const { AppModule } = await import('./app.module.js');
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cookieParser());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: '/', method: RequestMethod.GET },
      { path: 'health', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new DatabaseFilter());
  app.useGlobalInterceptors(new NoStoreInterceptor());
  const swagger = new DocumentBuilder()
    .setTitle('Freshman Learning API')
    .setVersion('1.0')
    .addCookieAuth('access_token')
    .build();
  SwaggerModule.setup(
    'api/docs',
    app,
    SwaggerModule.createDocument(app, swagger),
  );
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}
await bootstrap();
