import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { v4 as uuidv4 } from 'uuid';
import {
  Integration,
  IntegrationKey,
  IntegrationType,
  WhatsAppIntegrationData,
} from '../../schemas/integration.schema';
import { decrypt, encrypt } from '../../shared/shared.functions';

@Injectable()
export class IntegrationsCredentialsService {
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

    return this.decryptData(row.data);
  }

  async resolveBusinessByPhoneNumberId(
    phoneNumberId: string,
  ): Promise<{ idBusiness: string; credentials: WhatsAppIntegrationData } | null> {
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
      const data = this.decryptData(integration.data);
      if (data?.phoneNumberId === phoneNumberId && integration.idBusiness) {
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
    for (const item of rows) {
      const integration = item.toJSON() as Integration;
      if (!integration.isActive) {
        continue;
      }
      const data = this.decryptData(integration.data);
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
      const data = this.decryptData(integration.data);
      if (data?.phoneNumberId?.trim() === token) {
        return true;
      }
    }
    return false;
  }

  isConfigured(data: WhatsAppIntegrationData | null): boolean {
    if (!data) {
      return false;
    }
    return !!(
      data.phoneNumberId?.trim() &&
      data.accessToken?.trim() &&
      data.appSecret?.trim()
    );
  }

  async upsertWhatsAppIntegration(
    idBusiness: string,
    userId: string,
    data: WhatsAppIntegrationData,
  ): Promise<void> {
    const normalized = this.normalizeCredentials(data);
    const encryptedData = encrypt(JSON.stringify(normalized));

    const rows = await this.integrationModel
      .scan()
      .where('type')
      .eq(IntegrationType.WHATSAPP)
      .where('idBusiness')
      .eq(idBusiness)
      .exec();

    if (rows?.length) {
      const existing = rows[0].toJSON() as Integration;
      await this.integrationModel.update(
        { id: existing.id },
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

  private decryptData(encrypted: string): WhatsAppIntegrationData | null {
    try {
      const parsed = JSON.parse(decrypt(encrypted)) as WhatsAppIntegrationData;
      return this.normalizeCredentials(parsed);
    } catch {
      return null;
    }
  }

  private normalizeCredentials(
    data: WhatsAppIntegrationData,
  ): WhatsAppIntegrationData {
    return {
      ...data,
      phoneNumberId: data.phoneNumberId?.trim() ?? '',
      accessToken: data.accessToken?.trim() ?? '',
      appSecret: data.appSecret?.trim() ?? '',
    };
  }
}
