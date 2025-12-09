import 'reflect-metadata';

import { ClassSerializerInterceptor, INestApplication, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ExpressAdapter, NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Express, json, urlencoded } from 'express';
import * as requestIp from 'request-ip';

import { AppModule } from './app/app.module';

const cors = {
  origin: getOrigin(),
  methods: 'POST,OPTIONS,GET,PUT,PATCH,DELETE',
  allowedHeaders:
    'Content-Type, Accept, Authorization, X-Requested-With, Application, Origin, Access-Control-Allow-Origin, Access-Control-Allow-Credentials',
};

function getOrigin() {
  switch (process.env.NODE_ENV) {
    case 'prd':
      return 'https://app.vyvapos.com';
    case 'dev':
    case 'qas':
    default:
      return '*';
    // return 'https://qas.d2mrz2vv88ypo1.amplifyapp.com';
  }
}

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
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  app.enableCors(cors);

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

// bootstrap();
