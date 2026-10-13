import { Context } from 'aws-lambda';
import { createServer, proxy, Response } from 'aws-serverless-express';
import { Server } from 'http';
import * as express from 'express';

import { createApp } from './main';
import {
  injectAuthorizerContextIntoEvent,
  normalizeApiGatewayEvent,
} from './lambda-authorizer.util';

let cachedServer: Server;

async function bootstrap(): Promise<Server> {
  const expressApp = express();
  const app = await createApp(expressApp);
  await app.init();
  const server = createServer(expressApp);
  // aws-serverless-express le habla a este servidor por un socket local y, en
  // Node 20, reutiliza la conexión (keep-alive por defecto). El servidor cierra
  // las conexiones quietas a los 5 s, pero con la Lambda congelada ese reloj no
  // corre: al despertar, el cierre atrasado se cruza con la petición nueva y
  // sale ECONNRESET → 502 a los pocos milisegundos (13 oct 2026, timeslots de
  // Glow tras ~1 min sin uso). El único cliente es el propio proxy: sin tope.
  server.keepAliveTimeout = 0;
  return server;
}

export async function handler(event: any, context: Context): Promise<Response> {
  context.callbackWaitsForEmptyEventLoop = false;
  const normalizedEvent = normalizeApiGatewayEvent(event) ?? event;
  injectAuthorizerContextIntoEvent(normalizedEvent);

  if (!cachedServer) {
    const server = await bootstrap();
    cachedServer = server;
  }
  return proxy(cachedServer, normalizedEvent, context, 'PROMISE').promise;
}
