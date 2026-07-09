import 'reflect-metadata';

import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import {
  ExpressAdapter,
  NestExpressApplication,
} from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Express, json, urlencoded } from 'express';
import { eventContext } from 'aws-serverless-express/middleware';
import * as requestIp from 'request-ip';

import { AppModule } from './app/app.module';
import { buildCorsOptions } from './cors.config';

async function bootstrap(
  expressApp: Express | undefined = undefined,
  port: number | undefined = undefined,
) {
  const app =
    expressApp == undefined
      ? await NestFactory.create<NestExpressApplication>(AppModule, {
          logger: ['log', 'debug', 'error', 'verbose', 'warn'],
          bufferLogs: true,
        })
      : await NestFactory.create<NestExpressApplication>(
          AppModule,
          new ExpressAdapter(expressApp),
        );

  if (expressApp) {
    expressApp.use(eventContext());
  }

  app.setGlobalPrefix('api');
  app.enableCors(buildCorsOptions());
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));

  // Enable DTO validations
  app.useGlobalPipes(
    new ValidationPipe({
      forbidUnknownValues: true,
      /**
       * Se deben prohibir los parámetros que no vayan en el request para evitar que se envíen datos sensibles
       * forbidNonWhitelisted: true,
       */
      forbidNonWhitelisted: true,
      enableDebugMessages: true,
      stopAtFirstError: true,
      whitelist: true,
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const config = new DocumentBuilder()
    .setTitle('Vyva Backend')
    .setDescription('Description...')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  app.use(requestIp.mw());

  // Setting app port
  if (port !== undefined) {
    await app.listen(port);
  }

  return app;
}

export async function createApp(
  expressApp: Express,
): Promise<INestApplication> {
  return bootstrap(expressApp);
}

bootstrap(undefined, Number(process.env.PORT));