import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

import { WhatsAppService } from './whatsapp.service';

function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10) return null;
  if (digits.startsWith('57') && digits.length >= 12) return digits;
  if (digits.length === 10) return `57${digits}`;
  return digits;
}

function parseAllowedPhones(envValue?: string): Set<string> | null {
  const raw = envValue?.trim();
  if (!raw) return null;
  const allowed = new Set<string>();
  for (const part of raw.split(',')) {
    const phone = normalizePhone(part.trim());
    if (phone) allowed.add(phone);
  }
  return allowed.size > 0 ? allowed : null;
}

export interface CampaignDispatchPayload {
  campaignId: string;
  idBusiness: string;
  channel: string;
  rowIndex: number;
  recipient: {
    waPhone: string;
    bodyParameters: string[];
    bodyPreview?: string;
    clientMessageId: string;
  };
  template: {
    templateName: string;
    languageCode: string;
    templateBody?: string;
  };
}

@Injectable()
export class CampaignBatchService {
  private readonly logger = new Logger(CampaignBatchService.name);
  private readonly dynamo: DynamoDBClient;
  private readonly campaignsTable: string;
  private readonly allowedPhones: Set<string> | null;

  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly configService: ConfigService,
  ) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';
    const stage = this.configService.get<string>('NODE_ENV') || 'qas';
    this.dynamo = new DynamoDBClient({ region });
    this.campaignsTable = `${stage}-vyva-campaigns`;
    this.allowedPhones = parseAllowedPhones(
      this.configService.get<string>('CAMPAIGN_QAS_ALLOWED_PHONES'),
    );
  }

  async processDispatchMessage(payload: CampaignDispatchPayload): Promise<boolean> {
    if (payload.channel !== 'whatsapp') {
      this.logger.warn(`Unsupported channel ${payload.channel}`);
      return false;
    }

    const waPhone = normalizePhone(payload.recipient.waPhone) ?? payload.recipient.waPhone;
    if (this.allowedPhones && !this.allowedPhones.has(waPhone)) {
      this.logger.warn(`Blocked phone ${waPhone} (QAS allowlist)`);
      return false;
    }

    try {
      const result = await this.whatsAppService.sendTemplate(payload.idBusiness, {
        waPhone: payload.recipient.waPhone,
        templateName: payload.template.templateName,
        languageCode: payload.template.languageCode,
        bodyParameters: payload.recipient.bodyParameters,
        templateBody: payload.template.templateBody,
        bodyPreview: payload.recipient.bodyPreview,
        clientMessageId: payload.recipient.clientMessageId,
      });

      const success = result.success === true;
      await this.incrementStat(payload.campaignId, success ? 'sent' : 'failed');
      return success;
    } catch (err) {
      this.logger.error(
        `Campaign send failed campaign=${payload.campaignId} row=${payload.rowIndex}`,
        err,
      );
      await this.incrementStat(payload.campaignId, 'failed');
      return false;
    }
  }

  private async incrementStat(
    campaignId: string,
    field: 'sent' | 'failed',
  ): Promise<void> {
    await this.dynamo.send(
      new UpdateItemCommand({
        TableName: this.campaignsTable,
        Key: marshall({ id: campaignId }),
        UpdateExpression: `ADD stats.#field :one`,
        ExpressionAttributeNames: { '#field': field },
        ExpressionAttributeValues: marshall({ ':one': 1 }),
      }),
    );

    await this.maybeCompleteCampaign(campaignId);
  }

  private async maybeCompleteCampaign(campaignId: string): Promise<void> {
    const row = await this.dynamo.send(
      new GetItemCommand({
        TableName: this.campaignsTable,
        Key: marshall({ id: campaignId }),
      }),
    );
    if (!row.Item) return;

    const campaign = unmarshall(row.Item) as {
      status?: string;
      stats?: {
        total?: number;
        queued?: number;
        sent?: number;
        failed?: number;
        skippedDuplicates?: number;
      };
    };

    const stats = campaign.stats ?? {};
    const total = stats.total ?? stats.queued ?? 0;
    const done = (stats.sent ?? 0) + (stats.failed ?? 0);

    if (total > 0 && done >= total && campaign.status === 'sending') {
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.campaignsTable,
          Key: marshall({ id: campaignId }),
          UpdateExpression: 'SET #status = :completed',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: marshall({ ':completed': 'completed' }),
        }),
      );
    }
  }
}
