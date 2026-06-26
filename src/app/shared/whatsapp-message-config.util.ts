import {
  MetaTemplateSyncSource,
  WhatsAppMessageConfig,
  WhatsAppTemplateItem,
  WhatsAppTemplateMetaState,
} from './whatsapp-message-config.types';

export const WHATSAPP_MESSAGES_DOMAIN_GROUP = 'whatsappMessages';

export const APPOINTMENT_TEMPLATE_KEYS = [
  'booking',
  'pending',
  'confirmed',
  'completed',
] as const;

export type AppointmentTemplateKey = (typeof APPOINTMENT_TEMPLATE_KEYS)[number];

export const APPOINTMENT_META_TEMPLATE_NAMES: Record<
  AppointmentTemplateKey,
  string
> = {
  booking: 'vyva_appointment_booking',
  pending: 'vyva_appointment_pending',
  confirmed: 'vyva_appointment_confirmed',
  completed: 'vyva_appointment_completed',
};

export const DEFAULT_WHATSAPP_MESSAGE_CONFIG: WhatsAppMessageConfig = {
  dateFormat: 'dd/MM/yyyy',
  timeFormat: 'hh:mm a',
  metaLanguage: 'es',
  messages: {
    pending:
      'Hola {{customerName}}, {{greeting}}.\n\nPaso por acá para recordarte que tienes una cita de *{{serviceName}}* programada para:\n\n📅 *{{date}}*\n🕐 *{{startTime}}*\n\n¿Confirmamos tu asistencia?',
    confirmed:
      'Hola {{customerName}}, {{greeting}}.\n\nTu cita de *{{serviceName}}* está confirmada.\n\n📅 *{{date}}*\n🕐 *{{startTime}}*\n\nTe esperamos *15 minutos antes* para brindarte una mejor atención. ¡Hasta pronto!',
    completed:
      'Hola {{customerName}}, {{greeting}}.\n\n¿Cómo te fue con tu *{{serviceName}}*? ¿Cómo has sentido los resultados?\n\nTu opinión es muy importante para nosotros.',
    booking:
      '¡Todo listo, {{customerName}}! ✨\n\nTu cita quedó reservada:\n\n*{{serviceName}}* con {{employeeName}}\n📅 *{{date}}* a las *{{startTime}}*\n\nPara brindarte la atención personalizada que mereces, te pedimos llegar *10 minutos antes*. Ten en cuenta que nuestro tiempo de espera máximo es de 15 minutos.\n\nSi tu cita es a las 4:00 pm o más tarde, te agradeceríamos estar aquí *15 minutos antes*. Al ser el cierre de nuestra jornada, la puntualidad es clave para evitar reprogramaciones y garantizar que recibas tu tratamiento sin prisas.',
  },
};

export function customTemplateMetaName(key: string): string {
  const slug = key.replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
  return `vyva_custom_${slug}`;
}

export function resolveCustomMetaTemplateName(
  custom: Pick<WhatsAppTemplateItem, 'key' | 'title' | 'meta'>,
): string {
  if (custom.meta?.name?.trim()) {
    return custom.meta.name.trim();
  }

  const title = custom.title?.trim();
  if (title && title !== 'Nueva plantilla') {
    const slug = title
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (slug) {
      return `vyva_custom_${slug}`;
    }
  }

  return customTemplateMetaName(custom.key);
}

export function normalizeWhatsAppMessageConfig(
  raw?: Partial<WhatsAppMessageConfig> | null,
): WhatsAppMessageConfig {
  const defaults = DEFAULT_WHATSAPP_MESSAGE_CONFIG;
  return {
    dateFormat: raw?.dateFormat?.trim() || defaults.dateFormat,
    timeFormat: raw?.timeFormat?.trim() || defaults.timeFormat,
    metaLanguage: raw?.metaLanguage?.trim() || defaults.metaLanguage,
    messages: {
      booking: raw?.messages?.booking ?? defaults.messages.booking,
      pending: raw?.messages?.pending ?? defaults.messages.pending,
      confirmed: raw?.messages?.confirmed ?? defaults.messages.confirmed,
      completed: raw?.messages?.completed ?? defaults.messages.completed,
    },
    customTemplates: (raw?.customTemplates ?? []).map((template) => ({
      ...template,
      meta: template.meta ? { ...template.meta } : undefined,
    })),
    appointmentMeta: { ...(raw?.appointmentMeta ?? {}) },
  };
}

export function convertMetaBodyToVyva(
  metaBody: string,
  referenceVyvaBody?: string,
): string {
  if (!referenceVyvaBody?.trim()) {
    return metaBody;
  }

  const varNames: string[] = [];
  const seen = new Set<string>();
  for (const match of referenceVyvaBody.matchAll(/\{\{(\w+)\}\}/g)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      varNames.push(name);
    }
  }

  if (!varNames.length) {
    return metaBody;
  }

  return metaBody.replace(/\{\{(\d+)\}\}/g, (_match, numStr: string) => {
    const varName = varNames[Number(numStr) - 1];
    return varName ? `{{${varName}}}` : `{{${numStr}}}`;
  });
}

function normalizeMetaStatus(
  status?: string,
): WhatsAppTemplateMetaState['status'] | undefined {
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

function findMetaTemplateByName(
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

function buildMetaStateFromTemplate(
  metaTemplate: MetaTemplateSyncSource,
  existing?: WhatsAppTemplateMetaState,
): WhatsAppTemplateMetaState {
  const category =
    (metaTemplate.category as WhatsAppTemplateMetaState['category']) ??
    existing?.category ??
    'UTILITY';

  return {
    name: metaTemplate.name,
    language: metaTemplate.language,
    category,
    status: normalizeMetaStatus(metaTemplate.status) ?? existing?.status,
    metaTemplateId: existing?.metaTemplateId,
    lastRegisteredAt: existing?.lastRegisteredAt,
    lastError: existing?.lastError,
  };
}

/** When a Meta template shares the same name as a local one, Meta body/status win. */
export function syncWhatsAppConfigFromMeta(
  config: WhatsAppMessageConfig,
  metaTemplates: MetaTemplateSyncSource[],
): { config: WhatsAppMessageConfig; changed: boolean } {
  if (!metaTemplates.length) {
    return { config, changed: false };
  }

  const preferredLanguage = config.metaLanguage?.trim() || 'es';
  const next = normalizeWhatsAppMessageConfig(config);
  let changed = false;

  for (const [key, metaName] of Object.entries(APPOINTMENT_META_TEMPLATE_NAMES)) {
    const appointmentKey = key as AppointmentTemplateKey;
    const metaTemplate = findMetaTemplateByName(
      metaTemplates,
      metaName,
      preferredLanguage,
    );
    if (!metaTemplate?.preview?.trim()) {
      continue;
    }

    const currentBody = next.messages[appointmentKey] ?? '';
    const syncedBody = convertMetaBodyToVyva(metaTemplate.preview, currentBody);
    if (syncedBody !== currentBody) {
      next.messages = { ...next.messages, [appointmentKey]: syncedBody };
      changed = true;
    }

    const existingMeta = next.appointmentMeta?.[appointmentKey];
    const mergedMeta = buildMetaStateFromTemplate(metaTemplate, existingMeta);
    if (JSON.stringify(existingMeta) !== JSON.stringify(mergedMeta)) {
      next.appointmentMeta = {
        ...next.appointmentMeta,
        [appointmentKey]: mergedMeta,
      };
      changed = true;
    }
  }

  next.customTemplates = (next.customTemplates ?? []).map((custom) => {
    const metaName = resolveCustomMetaTemplateName(custom);
    const metaTemplate = findMetaTemplateByName(
      metaTemplates,
      metaName,
      preferredLanguage,
    );
    if (!metaTemplate?.preview?.trim()) {
      return custom;
    }

    let updated = custom;
    const syncedBody = convertMetaBodyToVyva(metaTemplate.preview, custom.body);
    if (syncedBody !== custom.body) {
      updated = { ...updated, body: syncedBody };
      changed = true;
    }

    const mergedMeta = buildMetaStateFromTemplate(metaTemplate, custom.meta);
    if (JSON.stringify(custom.meta) !== JSON.stringify(mergedMeta)) {
      updated = { ...updated, meta: mergedMeta };
      changed = true;
    }

    return updated;
  });

  return { config: next, changed };
}
