import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { v4 as uuidv4 } from 'uuid';
import {
  Integration,
  IntegrationKey,
  IntegrationType,
  WhatsAppIntegrationData,
} from '../../schemas/integration.schema';
import { decrypt, encrypt } from '../../shared/shared.functions';
import {
  isWhatsAppConfigured,
  normalizeWhatsAppIntegrationData,
  resolveWhatsAppIntegrationDataForSave,
} from '../../shared/whatsapp-integration.util';

@Injectable()
export class IntegrationsCredentialsService {
  private readonly logger = new Logger(IntegrationsCredentialsService.name);

  constructor(
    @InjectModel('Integration')
    private readonly integrationModel: Model<Integration, IntegrationKey>,
  ) {}

  async getByBusinessId(
    idBusiness: string,
  ): Promise<WhatsAppIntegrationData | null> {
    const rows = await this.integrationModel
      .scan()
      .where('type')
      .eq(IntegrationType.WHATSAPP)
      .where('idBusiness')
      .eq(idBusiness)
      .exec();

    if (!rows?.length) {
      return null;
    }

    const row = rows[0].toJSON() as Integration;
    if (!row.isActive) {
      return null;
    }

    return this.parseIntegrationData(row.data);
  }

  async resolveBusinessByPhoneNumberId(
    phoneNumberId: string,
  ): Promise<{ idBusiness: string; credentials: WhatsAppIntegrationData } | null> {
    const normalizedPhoneNumberId = phoneNumberId?.trim();
    if (!normalizedPhoneNumberId) {
      return null;
    }

    const rows = await this.integrationModel
      .scan()
      .where('type')
      .eq(IntegrationType.WHATSAPP)
      .exec();

    for (const item of rows) {
      const integration = item.toJSON() as Integration;
      if (!integration.isActive) {
        continue;
      }
      const data = this.parseIntegrationData(integration.data);
      if (
        data?.phoneNumberId &&
        String(data.phoneNumberId) === normalizedPhoneNumberId &&
        integration.idBusiness
      ) {
        return {
          idBusiness: integration.idBusiness,
          credentials: data,
        };
      }
    }

    return null;
  }

  /** App secrets configurados por negocio (Meta App Secret para firma del webhook POST). */
  async listAppSecrets(): Promise<string[]> {
    const rows = await this.integrationModel
      .scan()
      .where('type')
      .eq(IntegrationType.WHATSAPP)
      .exec();

    const secrets = new Set<string>();
    const envSecret = process.env.META_APP_SECRET?.trim();
    if (envSecret) {
      secrets.add(envSecret);
    }

    for (const item of rows) {
      const integration = item.toJSON() as Integration;
      if (!integration.isActive) {
        continue;
      }
      const data = this.parseIntegrationData(integration.data);
      const secret = data?.appSecret?.trim();
      if (secret) {
        secrets.add(secret);
      }
    }
    return [...secrets];
  }

  /**
   * Meta webhook GET challenge: Verify Token in Developer Console must match phoneNumberId.
   */
  async isWebhookVerifyTokenValid(token: string): Promise<boolean> {
    const normalizedToken = token?.trim();
    if (!normalizedToken) {
      return false;
    }

    try {
      const rows = await this.integrationModel
        .scan()
        .where('type')
        .eq(IntegrationType.WHATSAPP)
        .exec();

      for (const item of rows) {
        const integration = item.toJSON() as Integration;
        if (!integration.isActive) {
          continue;
        }
        const data = this.parseIntegrationData(integration.data);
        if (!data) {
          this.logger.warn(
            `Could not decrypt integration ${integration.id} for webhook verify token check`,
          );
          continue;
        }
        if (data.phoneNumberId === normalizedToken) {
          return true;
        }
        if (String(data.phoneNumberId) === normalizedToken) {
          return true;
        }
      }
      return false;
    } catch (err) {
      this.logger.error(
        `Webhook verify token scan failed: ${(err as Error)?.message ?? err}`,
        (err as Error)?.stack,
      );
      throw err;
    }
  }

  isConfigured(data: WhatsAppIntegrationData | null): boolean {
    return isWhatsAppConfigured(data);
  }

  async upsertWhatsAppIntegration(
    idBusiness: string,
    userId: string,
    data: WhatsAppIntegrationData,
  ): Promise<void> {
    const rows = await this.integrationModel
      .scan()
      .where('type')
      .eq(IntegrationType.WHATSAPP)
      .where('idBusiness')
      .eq(idBusiness)
      .exec();

    const existing =
      rows?.length > 0
        ? this.parseIntegrationData((rows[0].toJSON() as Integration).data)
        : null;

    const resolved = resolveWhatsAppIntegrationDataForSave(data, existing);
    const encryptedData = encrypt(JSON.stringify(resolved));

    if (rows?.length) {
      const existingRow = rows[0].toJSON() as Integration;
      await this.integrationModel.update(
        { id: existingRow.id },
        { data: encryptedData, isActive: true },
      );
      return;
    }

    await this.integrationModel.create({
      id: uuidv4(),
      type: IntegrationType.WHATSAPP,
      userId,
      idBusiness,
      data: encryptedData,
      isActive: true,
    });
  }

  async getIntegrationRow(
    idBusiness: string,
  ): Promise<Integration | null> {
    const rows = await this.integrationModel
      .scan()
      .where('type')
      .eq(IntegrationType.WHATSAPP)
      .where('idBusiness')
      .eq(idBusiness)
      .exec();

    if (!rows?.length) {
      return null;
    }

    return rows[0].toJSON() as Integration;
  }

  /**
   * integrations-api stores Integration.data encrypted (AES + JSON).
   * Decrypt before comparing credentials or validating webhook verify tokens.
   */
  private parseIntegrationData(
    raw: string | undefined | null,
  ): WhatsAppIntegrationData | null {
    if (!raw || typeof raw !== 'string') {
      return null;
    }

    const stored = raw.trim();
    if (!stored) {
      return null;
    }

    try {
      const decrypted = decrypt(stored);
      if (decrypted) {
        return normalizeWhatsAppIntegrationData(
          JSON.parse(decrypted) as WhatsAppIntegrationData,
        );
      }
    } catch {
      // Fall through: data may be plain JSON from legacy records.
    }

    try {
      const parsed = JSON.parse(stored) as WhatsAppIntegrationData;
      if (parsed && typeof parsed === 'object' && parsed.phoneNumberId) {
        return normalizeWhatsAppIntegrationData(parsed);
      }
    } catch {
      return null;
    }

    return null;
  }
}
