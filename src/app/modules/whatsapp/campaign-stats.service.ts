import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DynamoDBClient,
  GetItemCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';

export type CampaignStatField =
  | 'sent'
  | 'failed'
  | 'delivered'
  | 'read'
  | 'responded';

/**
 * Keeps the marketing campaign delivery counters (stored on the campaigns
 * table owned by vyva-campaign-api) in sync as WhatsApp messages are sent and
 * their Meta webhook statuses arrive. Lives in the WhatsApp service because it
 * is the source of truth for per-message delivery state.
 */
@Injectable()
export class CampaignStatsService {
  private readonly logger = new Logger(CampaignStatsService.name);
  private readonly dynamo: DynamoDBClient;
  private readonly campaignsTable: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';
    const stage = this.configService.get<string>('NODE_ENV') || 'qas';
    this.dynamo = new DynamoDBClient({ region });
    this.campaignsTable = `${stage}-vyva-campaigns`;
  }

  /** Atomically increments a single campaign stat counter. */
  async increment(campaignId: string, field: CampaignStatField): Promise<void> {
    if (!campaignId) return;
    try {
      await this.dynamo.send(
        new UpdateItemCommand({
          TableName: this.campaignsTable,
          Key: marshall({ id: campaignId }),
          UpdateExpression: 'ADD stats.#field :one',
          ExpressionAttributeNames: { '#field': field },
          ExpressionAttributeValues: marshall({ ':one': 1 }),
        }),
      );
    } catch (err) {
      this.logger.warn(
        `Failed to increment campaign stat ${field} for ${campaignId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Increments the send outcome counter and marks the campaign complete when done. */
  async recordSendOutcome(
    campaignId: string,
    success: boolean,
  ): Promise<void> {
    await this.increment(campaignId, success ? 'sent' : 'failed');
    await this.maybeCompleteCampaign(campaignId);
  }

  private async maybeCompleteCampaign(campaignId: string): Promise<void> {
    try {
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
          skippedNotAllowed?: number;
        };
      };

      const stats = campaign.stats ?? {};
      if (!this.isCampaignProcessingComplete(stats)) {
        return;
      }

      if (
        campaign.status === 'sending' ||
        campaign.status === 'dispatching'
      ) {
        await this.markCampaignCompleted(campaignId);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to evaluate campaign completion for ${campaignId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * A campaign is done when every contact was either dispatched (sent/failed)
   * or filtered out during orchestration (skipped duplicates / QAS allowlist).
   */
  private isCampaignProcessingComplete(stats: {
    total?: number;
    queued?: number;
    sent?: number;
    failed?: number;
    skippedDuplicates?: number;
    skippedNotAllowed?: number;
  }): boolean {
    const queued = stats.queued ?? 0;
    const processed = (stats.sent ?? 0) + (stats.failed ?? 0);
    const skipped =
      (stats.skippedDuplicates ?? 0) + (stats.skippedNotAllowed ?? 0);
    const total = stats.total ?? 0;

    if (queued > 0) {
      return processed >= queued;
    }

    if (total === 0) {
      return skipped > 0;
    }

    return skipped + processed >= total;
  }

  private async markCampaignCompleted(campaignId: string): Promise<void> {
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
