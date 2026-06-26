import {
  MetaTemplateSyncSource,
  WhatsAppMessageConfig,
  WhatsAppTemplateItem,
  WhatsAppTemplateMetaState,
  WhatsAppTemplateMetaStatus,
} from './whatsapp-message-config.types';
import {
  SaveWhatsAppTemplatePayload,
  WhatsAppTemplateCatalogItem,
  WhatsAppTemplateEditorDetail,
  WhatsAppTemplateMetaSnapshot,
} from './whatsapp-template-catalog.types';
import {
  APPOINTMENT_META_TEMPLATE_NAMES,
  APPOINTMENT_TEMPLATE_KEYS,
  AppointmentTemplateKey,
  convertMetaBodyToVyva,
  customTemplateMetaName,
  normalizeWhatsAppMessageConfig,
  resolveCustomMetaTemplateName,
} from './whatsapp-message-config.util';

const APPOINTMENT_TITLES: Record<AppointmentTemplateKey, string> = {
  booking: 'Reserva de cita',
  pending: 'Cita pendiente',
  confirmed: 'Cita confirmada',
  completed: 'Cita completada',
};

function normalizeMetaStatus(
  status?: string,
): WhatsAppTemplateMetaStatus | undefined {
  switch (status) {
    case 'APPROVED':
    case 'PENDING':
    case 'REJECTED':
    case 'PAUSED':
      return status;
    default:
      return undefined;
  }
}

export function findMetaTemplateByName(
  metaTemplates: MetaTemplateSyncSource[],
  name: string,
  preferredLanguage: string,
): MetaTemplateSyncSource | undefined {
  return (
    metaTemplates.find(
      (template) =>
        template.name === name && template.language === preferredLanguage,
    ) ?? metaTemplates.find((template) => template.name === name)
  );
}

export function buildMetaSnapshot(
  metaTemplate: MetaTemplateSyncSource | undefined,
): WhatsAppTemplateMetaSnapshot | null {
  if (!metaTemplate) {
    return null;
  }

  return {
    exists: true,
    name: metaTemplate.name,
    status: normalizeMetaStatus(metaTemplate.status),
    language: metaTemplate.language,
    category: metaTemplate.category,
    body: metaTemplate.preview?.trim() || undefined,
    bodyParameterCount: (metaTemplate.preview?.match(/\{\{\d+\}\}/g) ?? [])
      .length
      ? Math.max(
          ...(metaTemplate.preview?.match(/\{\{\d+\}\}/g) ?? []).map((m) =>
            Number(m.replace(/\D/g, '')),
          ),
        )
      : 0,
  };
}

function resolveMetaNameForKey(
  config: WhatsAppMessageConfig,
  key: string,
  kind: 'appointment' | 'custom',
  custom?: WhatsAppTemplateItem,
): string {
  if (kind === 'appointment') {
    return APPOINTMENT_META_TEMPLATE_NAMES[key as AppointmentTemplateKey];
  }
  if (custom) {
    return resolveCustomMetaTemplateName(custom);
  }
  return customTemplateMetaName(key);
}

export function resolveTemplateKind(
  config: WhatsAppMessageConfig,
  key: string,
): { kind: 'appointment' | 'custom'; custom?: WhatsAppTemplateItem } {
  if (APPOINTMENT_TEMPLATE_KEYS.includes(key as AppointmentTemplateKey)) {
    return { kind: 'appointment' };
  }

  const custom = (config.customTemplates ?? []).find(
    (template) => template.key === key,
  );
  return { kind: 'custom', custom };
}

export function buildWhatsAppTemplateCatalog(
  rawConfig: WhatsAppMessageConfig,
  metaTemplates: MetaTemplateSyncSource[] | null,
): WhatsAppTemplateCatalogItem[] {
  const config = normalizeWhatsAppMessageConfig(rawConfig);
  const preferredLanguage = config.metaLanguage?.trim() || 'es';
  const items: WhatsAppTemplateCatalogItem[] = [];

  for (const key of APPOINTMENT_TEMPLATE_KEYS) {
    const metaName = APPOINTMENT_META_TEMPLATE_NAMES[key];
    const metaTemplate = metaTemplates
      ? findMetaTemplateByName(metaTemplates, metaName, preferredLanguage)
      : undefined;
    const domainBody = config.messages[key] ?? '';

    items.push({
      key,
      kind: 'appointment',
      title: APPOINTMENT_TITLES[key],
      description: domainBody,
      meta: buildMetaSnapshot(metaTemplate),
    });
  }

  for (const custom of config.customTemplates ?? []) {
    const metaName = resolveCustomMetaTemplateName(custom);
    const metaTemplate = metaTemplates
      ? findMetaTemplateByName(metaTemplates, metaName, preferredLanguage)
      : undefined;

    items.push({
      key: custom.key,
      kind: 'custom',
      title: custom.title?.trim() || 'Plantilla personalizada',
      description: custom.description?.trim() || custom.body,
      meta: buildMetaSnapshot(metaTemplate),
    });
  }

  return items;
}

export function buildWhatsAppTemplateEditorDetail(
  rawConfig: WhatsAppMessageConfig,
  key: string,
  metaTemplates: MetaTemplateSyncSource[] | null,
): WhatsAppTemplateEditorDetail | null {
  const config = normalizeWhatsAppMessageConfig(rawConfig);
  const { kind, custom } = resolveTemplateKind(config, key);
  const preferredLanguage = config.metaLanguage?.trim() || 'es';

  let domainBody: string;
  let title: string;
  let description: string;
  let metaCategory: WhatsAppTemplateItem['metaCategory'] = 'UTILITY';
  let appointmentMeta: WhatsAppTemplateMetaState | undefined;

  if (kind === 'appointment') {
    const appointmentKey = key as AppointmentTemplateKey;
    domainBody = config.messages[appointmentKey] ?? '';
    title = APPOINTMENT_TITLES[appointmentKey];
    description = domainBody;
    appointmentMeta = config.appointmentMeta?.[appointmentKey];
    metaCategory = appointmentMeta?.category ?? 'UTILITY';
  } else if (custom) {
    domainBody = custom.body;
    title = custom.title?.trim() || 'Plantilla personalizada';
    description = custom.description?.trim() || custom.body;
    metaCategory = custom.metaCategory ?? custom.meta?.category ?? 'UTILITY';
    appointmentMeta = custom.meta;
  } else {
    return null;
  }

  const metaName = resolveMetaNameForKey(config, key, kind, custom);
  const metaTemplate = metaTemplates
    ? findMetaTemplateByName(metaTemplates, metaName, preferredLanguage)
    : undefined;
  const metaSnapshot = buildMetaSnapshot(metaTemplate);
  const displayBody =
    metaSnapshot?.body?.trim()
      ? convertMetaBodyToVyva(metaSnapshot.body, domainBody)
      : domainBody;

  return {
    key,
    kind,
    dateFormat: config.dateFormat,
    timeFormat: config.timeFormat,
    metaLanguage: preferredLanguage,
    title,
    description,
    metaCategory,
    displayBody,
    domainBody,
    meta: metaSnapshot,
    appointmentMeta,
  };
}

export function applyTemplateSaveToConfig(
  rawConfig: WhatsAppMessageConfig,
  key: string,
  payload: SaveWhatsAppTemplatePayload,
): WhatsAppMessageConfig {
  const config = normalizeWhatsAppMessageConfig(rawConfig);
  const { kind, custom } = resolveTemplateKind(config, key);
  const body = payload.body.trim();

  if (payload.dateFormat?.trim()) {
    config.dateFormat = payload.dateFormat.trim();
  }
  if (payload.timeFormat?.trim()) {
    config.timeFormat = payload.timeFormat.trim();
  }
  if (payload.metaLanguage?.trim()) {
    config.metaLanguage = payload.metaLanguage.trim();
  }

  if (kind === 'appointment') {
    const appointmentKey = key as AppointmentTemplateKey;
    config.messages = { ...config.messages, [appointmentKey]: body };
    return config;
  }

  const metaCategory = payload.metaCategory ?? custom?.metaCategory ?? 'UTILITY';
  const title = payload.title?.trim() || custom?.title || 'Nueva plantilla';
  const description = payload.description?.trim() || custom?.description || body;

  if (custom) {
    config.customTemplates = (config.customTemplates ?? []).map((item) =>
      item.key === key
        ? {
            ...item,
            title,
            description,
            body,
            metaCategory,
          }
        : item,
    );
    return config;
  }

  config.customTemplates = [
    ...(config.customTemplates ?? []),
    {
      key,
      kind: 'custom',
      title,
      description,
      body,
      metaCategory,
    },
  ];
  return config;
}

export function resolveMetaRegistrationName(
  config: WhatsAppMessageConfig,
  key: string,
): string {
  const { kind, custom } = resolveTemplateKind(config, key);
  return resolveMetaNameForKey(config, key, kind, custom);
}

export function applyRegistrationResultToConfig(
  config: WhatsAppMessageConfig,
  key: string,
  result: {
    name: string;
    success: boolean;
    status?: string;
    metaTemplateId?: string;
    error?: string;
  },
  metaCategory: WhatsAppTemplateItem['metaCategory'],
  language: string,
): WhatsAppMessageConfig {
  const next = normalizeWhatsAppMessageConfig(config);
  const { kind } = resolveTemplateKind(next, key);
  const existingMeta =
    kind === 'appointment'
      ? next.appointmentMeta?.[key as AppointmentTemplateKey]
      : next.customTemplates?.find((template) => template.key === key)?.meta;

  const meta: WhatsAppTemplateMetaState = {
    ...existingMeta,
    name: result.name,
    language,
    category: metaCategory,
    status: result.success
      ? (normalizeMetaStatus(result.status) ?? existingMeta?.status ?? 'PENDING')
      : existingMeta?.status,
    metaTemplateId: result.metaTemplateId ?? existingMeta?.metaTemplateId,
    lastRegisteredAt: result.success ? Date.now() : existingMeta?.lastRegisteredAt,
    lastError: result.success ? undefined : result.error ?? existingMeta?.lastError,
  };

  if (kind === 'appointment') {
    next.appointmentMeta = {
      ...next.appointmentMeta,
      [key as AppointmentTemplateKey]: meta,
    };
    return next;
  }

  next.customTemplates = (next.customTemplates ?? []).map((template) =>
    template.key === key ? { ...template, meta } : template,
  );
  return next;
}
