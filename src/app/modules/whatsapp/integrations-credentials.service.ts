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
  selectCanonicalWhatsAppIntegrationRow,
  listDuplicateIntegrationRows,
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
    const row = await this.dedupeWhatsAppIntegrationRow(idBusiness);
    if (!row) {
      return null;
    }

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

  isConfigured(data: WhatsAppIntegrationData | null): boolean {
    return isWhatsAppConfigured(data);
  }

  async upsertWhatsAppIntegration(
    idBusiness: string,
    userId: string,
    data: WhatsAppIntegrationData,
  ): Promise<void> {
    const normalizedBusinessId = idBusiness?.trim();
    if (!normalizedBusinessId) {
      throw new Error('idBusiness is required to save WhatsApp integration');
    }

    const existingRow = await this.dedupeWhatsAppIntegrationRow(
      normalizedBusinessId,
    );
    const existing = existingRow
      ? this.parseIntegrationData(existingRow.data)
      : null;

    const resolved = resolveWhatsAppIntegrationDataForSave(data, existing);
    const encryptedData = encrypt(JSON.stringify(resolved));

    if (existingRow) {
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
      idBusiness: normalizedBusinessId,
      data: encryptedData,
      isActive: true,
    });
  }

  async markPhoneRegistered(
    idBusiness: string,
    twoStepPin?: string,
  ): Promise<void> {
    const row = await this.getIntegrationRow(idBusiness);
    if (!row) {
      return;
    }

    const existing = this.parseIntegrationData(row.data);
    if (!existing) {
      return;
    }

    const resolved = resolveWhatsAppIntegrationDataForSave(
      {
        ...existing,
        phoneRegistered: true,
        twoStepPin: twoStepPin?.trim() || existing.twoStepPin,
      },
      existing,
    );
    const encryptedData = encrypt(JSON.stringify(resolved));
    await this.integrationModel.update({ id: row.id }, { data: encryptedData });
  }

  async markMetaPaymentMethodConfirmed(idBusiness: string): Promise<void> {
    const row = await this.getIntegrationRow(idBusiness);
    if (!row) {
      return;
    }

    const existing = this.parseIntegrationData(row.data);
    if (!existing) {
      return;
    }

    const resolved = resolveWhatsAppIntegrationDataForSave(
      {
        ...existing,
        metaPaymentMethodConfirmed: true,
      },
      existing,
    );
    const encryptedData = encrypt(JSON.stringify(resolved));
    await this.integrationModel.update({ id: row.id }, { data: encryptedData });
  }

  async getIntegrationRow(
    idBusiness: string,
  ): Promise<Integration | null> {
    return this.dedupeWhatsAppIntegrationRow(idBusiness);
  }

  private async listWhatsAppIntegrationRows(
    idBusiness: string,
  ): Promise<Integration[]> {
    const normalizedBusinessId = idBusiness?.trim();
    if (!normalizedBusinessId) {
      return [];
    }

    const rows = await this.integrationModel
      .scan()
      .where('type')
      .eq(IntegrationType.WHATSAPP)
      .where('idBusiness')
      .eq(normalizedBusinessId)
      .exec();

    return (rows ?? []).map((row) => row.toJSON() as Integration);
  }

  /** Ensures a single WhatsApp integration record exists per Vyva business. */
  private async dedupeWhatsAppIntegrationRow(
    idBusiness: string,
  ): Promise<Integration | null> {
    const rows = await this.listWhatsAppIntegrationRows(idBusiness);
    const canonical = selectCanonicalWhatsAppIntegrationRow(rows, (row) => {
      const data = this.parseIntegrationData(row.data);
      return isWhatsAppConfigured(data);
    });
    if (!canonical) {
      return null;
    }

    for (const duplicate of listDuplicateIntegrationRows(rows, canonical.id)) {
      this.logger.warn(
        `Removing duplicate WhatsApp integration ${duplicate.id} for business ${idBusiness}`,
      );
      await this.integrationModel.delete({ id: duplicate.id });
    }

    return canonical;
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
