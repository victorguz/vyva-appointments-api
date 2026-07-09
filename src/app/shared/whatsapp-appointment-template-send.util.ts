import {
  APPOINTMENT_META_TEMPLATE_NAMES,
  AppointmentTemplateKey,
} from './whatsapp-message-config.util';
import { WhatsAppMessageConfig } from './whatsapp-message-config.types';
import { WhatsAppNotificationSettings } from './whatsapp-notification.util';
import {
  AppointmentTemplateContext,
  buildAppointmentTemplateSendPayload,
} from './whatsapp-template-variables.util';

export interface AppointmentTemplateSendPlan {
  whatsappBusinessId: string;
  templateName: string;
  languageCode: string;
  bodyParameters: string[];
  metaBody: string;
  resolvedTemplateKey: AppointmentTemplateKey;
  requestedTemplateKey: AppointmentTemplateKey;
}

export function resolveWhatsAppBusinessIdForAppointment(
  settings: WhatsAppNotificationSettings,
  appointmentBusinessId: string,
  vyvaBusinessId: string | undefined,
  hasOwnWhatsAppIntegration: boolean,
): string {
  if (settings.useOwnWhatsAppAccount) {
    return appointmentBusinessId;
  }

  if (vyvaBusinessId) {
    if (hasOwnWhatsAppIntegration) {
      return appointmentBusinessId;
    }
    return vyvaBusinessId;
  }

  return appointmentBusinessId;
}

function resolveRegisteredTemplateName(
  config: WhatsAppMessageConfig,
  templateKey: AppointmentTemplateKey,
): string {
  const storedName = config.appointmentMeta?.[templateKey]?.name?.trim();
  return storedName || APPOINTMENT_META_TEMPLATE_NAMES[templateKey];
}

function resolveTemplateLanguage(
  config: WhatsAppMessageConfig,
  templateKey: AppointmentTemplateKey,
): string {
  const fromMeta = config.appointmentMeta?.[templateKey]?.language?.trim();
  return fromMeta || config.metaLanguage?.trim() || 'es';
}

function isAppointmentTemplateApproved(
  config: WhatsAppMessageConfig,
  templateKey: AppointmentTemplateKey,
): boolean {
  const meta = config.appointmentMeta?.[templateKey];
  if (!meta) {
    // `pending` is the primary template; assume it works if not explicitly configured.
    // All other keys require an explicit APPROVED entry to be used directly.
    return templateKey === 'pending';
  }
  return meta.status === 'APPROVED';
}

function tryResolveTemplateMeta(
  config: WhatsAppMessageConfig,
  templateKey: AppointmentTemplateKey,
): Pick<
  AppointmentTemplateSendPlan,
  'templateName' | 'languageCode' | 'resolvedTemplateKey'
> | null {
  if (!isAppointmentTemplateApproved(config, templateKey)) {
    return null;
  }

  return {
    templateName: resolveRegisteredTemplateName(config, templateKey),
    languageCode: resolveTemplateLanguage(config, templateKey),
    resolvedTemplateKey: templateKey,
  };
}

export function resolveSendableAppointmentTemplateMeta(
  config: WhatsAppMessageConfig,
  requestedKey: AppointmentTemplateKey,
): Pick<
  AppointmentTemplateSendPlan,
  'templateName' | 'languageCode' | 'resolvedTemplateKey'
> | null {
  const direct = tryResolveTemplateMeta(config, requestedKey);
  if (direct) {
    return direct;
  }

  // For any key without an approved template, fall back to `pending`.
  if (requestedKey !== 'pending') {
    return tryResolveTemplateMeta(config, 'pending');
  }

  return null;
}

export function buildAppointmentTemplateSendPlan(
  config: WhatsAppMessageConfig,
  whatsappBusinessId: string,
  requestedKey: AppointmentTemplateKey,
  context: AppointmentTemplateContext,
): AppointmentTemplateSendPlan | null {
  const meta = resolveSendableAppointmentTemplateMeta(config, requestedKey);
  if (!meta) {
    return null;
  }

  const built = buildAppointmentTemplateSendPayload(
    config,
    meta.resolvedTemplateKey,
    context,
  );

  return {
    whatsappBusinessId,
    templateName: meta.templateName,
    languageCode: meta.languageCode,
    bodyParameters: built.bodyParameters,
    metaBody: built.metaBody,
    resolvedTemplateKey: meta.resolvedTemplateKey,
    requestedTemplateKey: requestedKey,
  };
}

export function businessHasWhatsAppMessageConfig(
  config: WhatsAppMessageConfig,
  domainId?: string,
): boolean {
  return Boolean(domainId);
}
