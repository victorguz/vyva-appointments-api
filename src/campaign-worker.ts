import { Context, SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { INestApplication } from '@nestjs/common';
import * as express from 'express';

import { createApp } from './main';
import { CampaignBatchService } from './app/modules/whatsapp/campaign-batch.service';

let cachedApp: INestApplication | null = null;

async function getApp(): Promise<INestApplication> {
  if (cachedApp) return cachedApp;
  const expressApp = express();
  cachedApp = await createApp(expressApp);
  await cachedApp.init();
  return cachedApp;
}

export async function handler(
  event: SQSEvent,
  context: Context,
): Promise<SQSBatchResponse> {
  context.callbackWaitsForEmptyEventLoop = false;

  const app = await getApp();
  const batchService = app.get(CampaignBatchService);
  const batchItemFailures: { itemIdentifier: string }[] = [];

  for (const record of event.Records) {
    try {
      const payload = JSON.parse(record.body);
      const ok = await batchService.processDispatchMessage(payload);
      if (!ok) {
        batchItemFailures.push({ itemIdentifier: record.messageId });
      }
    } catch {
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
}
