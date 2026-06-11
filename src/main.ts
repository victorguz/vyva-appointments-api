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

import { AppModule } from './app/app.module';

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

  app.setGlobalPrefix('api');
  app.use(
    json({
      limit: '10mb',
      verify: (req: any, _res, buf) => {
        if (req.url?.includes('/whatsapp/webhook')) {
          req.rawBody = buf;
        }
      },
    }),
  );
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