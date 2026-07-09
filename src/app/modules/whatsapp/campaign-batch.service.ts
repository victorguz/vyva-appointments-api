import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { WhatsAppService } from './whatsapp.service';
import { CampaignStatsService } from './campaign-stats.service';

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

export interface CampaignAppointmentContext {
  customerName?: string;
  serviceName?: string;
  employeeName?: string;
  startDate: string | number;
  endDate?: string | number;
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
    bodyFieldMapping?: string[];
    /** When set, whatsapp-api resolves the template in appointment mode. */
    appointmentTemplateKey?: 'booking' | 'pending' | 'confirmed' | 'completed';
    appointmentContext?: CampaignAppointmentContext;
    appointmentBusinessId?: string;
    idCustomer?: string;
  };
}

@Injectable()
export class CampaignBatchService {
  private readonly logger = new Logger(CampaignBatchService.name);
  private readonly allowedPhones: Set<string> | null;

  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly configService: ConfigService,
    private readonly campaignStats: CampaignStatsService,
  ) {
    this.allowedPhones = parseAllowedPhones(
      this.configService.get<string>('CAMPAIGN_QAS_ALLOWED_PHONES'),
    );
  }

  async processDispatchMessage(payload: CampaignDispatchPayload): Promise<boolean> {
    if (payload.channel !== 'whatsapp') {
      this.logger.warn(`Unsupported channel ${payload.channel}`);
      await this.campaignStats.recordSendOutcome(payload.campaignId, false);
      return true;
    }

    const waPhone = normalizePhone(payload.recipient.waPhone) ?? payload.recipient.waPhone;
    const isAppointmentMode = Boolean(
      payload.template.appointmentTemplateKey &&
        payload.template.appointmentContext,
    );

    // Marketing CSV campaigns keep the stage allowlist. Appointment reminders
    // already use domain recipientPhones from whatsappNotificationSettings.
    if (
      !isAppointmentMode &&
      this.allowedPhones &&
      !this.allowedPhones.has(waPhone)
    ) {
      this.logger.warn(`Blocked phone ${waPhone} (QAS allowlist)`);
      await this.campaignStats.recordSendOutcome(payload.campaignId, false);
      return true;
    }

    try {
      const result = await this.whatsAppService.sendTemplate(payload.idBusiness, {
        waPhone: payload.recipient.waPhone,
        templateName: payload.template.templateName,
        languageCode: payload.template.languageCode,
        bodyParameters: payload.recipient.bodyParameters,
        templateBody: payload.template.templateBody,
        bodyFieldMapping: payload.template.bodyFieldMapping,
        bodyPreview: payload.recipient.bodyPreview,
        clientMessageId: payload.recipient.clientMessageId,
        idCampaign: payload.campaignId,
        ...(isAppointmentMode
          ? {
              appointmentTemplateKey: payload.template.appointmentTemplateKey,
              appointmentContext: payload.template.appointmentContext,
              appointmentBusinessId: payload.template.appointmentBusinessId,
              idCustomer: payload.template.idCustomer,
            }
          : {}),
      });

      const success = result.success === true;
      await this.campaignStats.recordSendOutcome(payload.campaignId, success);
      return true;
    } catch (err) {
      this.logger.error(
        `Campaign send failed campaign=${payload.campaignId} row=${payload.rowIndex}`,
        err,
      );
      await this.campaignStats.recordSendOutcome(payload.campaignId, false);
      return true;
    }
  }
}
