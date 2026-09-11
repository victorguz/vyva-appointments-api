import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LambdaClient, InvokeCommand, InvocationType } from '@aws-sdk/client-lambda';

/**
 * Fire-and-forget publisher for the internal automations engine
 * (vyva-automations-api). Producer APIs call `dispatch(...)` right after a
 * create/update/delete instead of hand-rolling WhatsApp/Calendar/reminders
 * side effects themselves — the automations Lambda queries the `automations`
 * rules table and decides what to do.
 */
@Injectable()
export class WebhookDispatchService {
  private readonly logger = new Logger(WebhookDispatchService.name);
  private readonly lambdaClient: LambdaClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';
    this.lambdaClient = new LambdaClient({ region });
  }

  /**
   * @param eventType e.g. "appointments.create", "appointments.update"
   * @param payload event payload evaluated against each rule's conditions
   * @param idBusiness scopes which rules apply (global rules always apply)
   */
  async dispatch(
    eventType: string,
    payload: Record<string, unknown>,
    idBusiness?: string,
  ): Promise<void> {
    try {
      const stage = this.configService.get<string>('NODE_ENV') || 'qas';
      const functionName = `vyva-automations-${stage}-invokeWebhook`;

      await this.lambdaClient.send(
        new InvokeCommand({
          FunctionName: functionName,
          InvocationType: InvocationType.Event,
          Payload: Buffer.from(
            JSON.stringify({ event_type: eventType, payload, idBusiness }),
          ),
        }),
      );
    } catch (error) {
      // A failed automation dispatch must never break the caller's request.
      this.logger.warn(
        `dispatch(${eventType}) failed: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }
}
