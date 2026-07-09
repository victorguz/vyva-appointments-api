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
  return createServer(expressApp);
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
