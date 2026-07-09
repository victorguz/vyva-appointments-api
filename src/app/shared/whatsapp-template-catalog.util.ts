import {
  MetaTemplateSyncSource,
  WhatsAppMessageConfig,
  WhatsAppTemplateButton,
  WhatsAppTemplateItem,
  WhatsAppTemplateLayout,
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
  findMetaTemplateByCandidates,
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
  // Exact-name lookup only. Prefix/fallback matching is handled by
  // findMetaTemplateByCandidates / resolveAppointmentCatalogMetaTemplate.
  return (
    metaTemplates.find(
      (template) =>
        template.name === name && template.language === preferredLanguage,
    ) ?? metaTemplates.find((template) => template.name === name)
  );
}

function resolveAppointmentCatalogMetaTemplate(
  metaTemplates: MetaTemplateSyncSource[],
  key: AppointmentTemplateKey,
  stored: WhatsAppTemplateMetaState | undefined,
  preferredLanguage: string,
): MetaTemplateSyncSource | undefined {
  const canonicalName = APPOINTMENT_META_TEMPLATE_NAMES[key];
  return findMetaTemplateByCandidates(
    metaTemplates,
    [stored?.name, canonicalName],
    preferredLanguage,
    { prefixBases: [canonicalName, stored?.name] },
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

function buildMetaSnapshotFromStored(
  stored?: WhatsAppTemplateMetaState,
): WhatsAppTemplateMetaSnapshot | null {
  if (!stored?.status && !stored?.name) {
    return null;
  }

  return {
    exists: Boolean(stored.status),
    name: stored.name,
    status: normalizeMetaStatus(stored.status),
    language: stored.language,
    category: stored.category,
  };
}

function resolveCatalogMetaSnapshot(
  metaTemplate: MetaTemplateSyncSource | undefined,
  stored?: WhatsAppTemplateMetaState,
): WhatsAppTemplateMetaSnapshot | null {
  return buildMetaSnapshot(metaTemplate) ?? buildMetaSnapshotFromStored(stored);
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

function normalizeButtons(
  buttons?: WhatsAppTemplateButton[],
): WhatsAppTemplateButton[] | undefined {
  const normalized = (buttons ?? [])
    .map((button) => ({
      type: button.type,
      text: button.text?.trim() ?? '',
      url: button.url?.trim() || undefined,
    }))
    .filter((button) => button.text);
  return normalized.length ? normalized : undefined;
}

function layoutSignature(layout?: WhatsAppTemplateLayout): string {
  return JSON.stringify({
    header: layout?.header?.trim() ?? '',
    footer: layout?.footer?.trim() ?? '',
    buttons: normalizeButtons(layout?.buttons) ?? [],
  });
}

export function getTemplateLayout(
  config: WhatsAppMessageConfig,
  key: string,
): WhatsAppTemplateLayout {
  const { kind, custom } = resolveTemplateKind(config, key);
  if (kind === 'appointment') {
    return config.appointmentTemplateLayout?.[key as AppointmentTemplateKey] ?? {};
  }
  return {
    header: custom?.header,
    footer: custom?.footer,
    buttons: custom?.buttons,
  };
}

export function buildWhatsAppTemplateCatalog(
  rawConfig: WhatsAppMessageConfig,
  metaTemplates: MetaTemplateSyncSource[] | null,
): WhatsAppTemplateCatalogItem[] {
  const config = normalizeWhatsAppMessageConfig(rawConfig);
  const preferredLanguage = config.metaLanguage?.trim() || 'es';
  const items: WhatsAppTemplateCatalogItem[] = [];

  for (const key of APPOINTMENT_TEMPLATE_KEYS) {
    const storedMeta = config.appointmentMeta?.[key];
    const metaTemplate = metaTemplates
      ? resolveAppointmentCatalogMetaTemplate(
          metaTemplates,
          key,
          storedMeta,
          preferredLanguage,
        )
      : undefined;
    const domainBody = config.messages[key] ?? '';

    items.push({
      key,
      kind: 'appointment',
      title: APPOINTMENT_TITLES[key],
      description: domainBody,
      meta: resolveCatalogMetaSnapshot(metaTemplate, storedMeta),
    });
  }

  for (const custom of config.customTemplates ?? []) {
    const metaName = resolveCustomMetaTemplateName(custom);
    const metaTemplate = metaTemplates
      ? findMetaTemplateByCandidates(
          metaTemplates,
          [custom.meta?.name, metaName],
          preferredLanguage,
          { prefixBases: [metaName, custom.meta?.name] },
        )
      : undefined;

    items.push({
      key: custom.key,
      kind: 'custom',
      title: custom.title?.trim() || 'Plantilla personalizada',
      description: custom.description?.trim() || custom.body,
      meta: resolveCatalogMetaSnapshot(metaTemplate, custom.meta),
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
  let domainHeader: string | undefined;
  let domainFooter: string | undefined;
  let domainButtons: WhatsAppTemplateButton[] | undefined;
  let title: string;
  let description: string;
  let metaCategory: WhatsAppTemplateItem['metaCategory'] = 'UTILITY';
  let appointmentMeta: WhatsAppTemplateMetaState | undefined;

  if (kind === 'appointment') {
    const appointmentKey = key as AppointmentTemplateKey;
    domainBody = config.messages[appointmentKey] ?? '';
    const layout = config.appointmentTemplateLayout?.[appointmentKey];
    domainHeader = layout?.header;
    domainFooter = layout?.footer;
    domainButtons = layout?.buttons;
    title = APPOINTMENT_TITLES[appointmentKey];
    description = domainBody;
    appointmentMeta = config.appointmentMeta?.[appointmentKey];
    metaCategory = appointmentMeta?.category ?? 'UTILITY';
  } else if (custom) {
    domainBody = custom.body;
    domainHeader = custom.header;
    domainFooter = custom.footer;
    domainButtons = custom.buttons;
    title = custom.title?.trim() || 'Plantilla personalizada';
    description = custom.description?.trim() || custom.body;
    metaCategory = custom.metaCategory ?? custom.meta?.category ?? 'UTILITY';
    appointmentMeta = custom.meta;
  } else {
    return null;
  }

  const metaName = resolveMetaNameForKey(config, key, kind, custom);
  const metaTemplate = metaTemplates
    ? kind === 'appointment'
      ? resolveAppointmentCatalogMetaTemplate(
          metaTemplates,
          key as AppointmentTemplateKey,
          appointmentMeta,
          preferredLanguage,
        )
      : findMetaTemplateByCandidates(
          metaTemplates,
          [appointmentMeta?.name, metaName],
          preferredLanguage,
          { prefixBases: [metaName, appointmentMeta?.name] },
        )
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
    domainHeader,
    domainFooter,
    domainButtons,
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
  const layout: WhatsAppTemplateLayout = {
    header: payload.header?.trim() || undefined,
    footer: payload.footer?.trim() || undefined,
    buttons: normalizeButtons(payload.buttons),
  };

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
    config.appointmentTemplateLayout = {
      ...(config.appointmentTemplateLayout ?? {}),
      [appointmentKey]: layout,
    };
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
            header: layout.header,
            footer: layout.footer,
            buttons: layout.buttons,
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
      header: layout.header,
      footer: layout.footer,
      buttons: layout.buttons,
      metaCategory,
    },
  ];
  return config;
}

export function getTemplateDomainBody(
  config: WhatsAppMessageConfig,
  key: string,
): string {
  const { kind, custom } = resolveTemplateKind(config, key);
  if (kind === 'appointment') {
    return (config.messages[key as AppointmentTemplateKey] ?? '').trim();
  }
  return (custom?.body ?? '').trim();
}

export function templateRequiresMetaRegistration(
  config: WhatsAppMessageConfig,
  key: string,
  payload: Pick<
    SaveWhatsAppTemplatePayload,
    'body' | 'metaCategory' | 'header' | 'footer' | 'buttons'
  >,
): boolean {
  const previousBody = getTemplateDomainBody(config, key);
  if (previousBody !== payload.body.trim()) {
    return true;
  }

  const previousLayout = getTemplateLayout(config, key);
  const nextLayout: WhatsAppTemplateLayout = {
    header: payload.header?.trim() || undefined,
    footer: payload.footer?.trim() || undefined,
    buttons: normalizeButtons(payload.buttons),
  };
  if (layoutSignature(previousLayout) !== layoutSignature(nextLayout)) {
    return true;
  }

  const { kind, custom } = resolveTemplateKind(config, key);
  const existingMeta =
    kind === 'appointment'
      ? config.appointmentMeta?.[key as AppointmentTemplateKey]
      : custom?.meta;

  if (!existingMeta?.metaTemplateId && !existingMeta?.lastRegisteredAt) {
    return true;
  }

  if (kind === 'custom' && payload.metaCategory) {
    const previousCategory =
      custom?.metaCategory ?? existingMeta?.category ?? 'UTILITY';
    if (payload.metaCategory !== previousCategory) {
      return true;
    }
  }

  return false;
}

/** Updates stored Meta linkage (status, name, …) without overwriting the domain body. */
export function applyTemplateMetaStateFromMeta(
  config: WhatsAppMessageConfig,
  key: string,
  metaTemplates: MetaTemplateSyncSource[],
): WhatsAppMessageConfig {
  if (!metaTemplates.length) {
    return config;
  }

  const next = normalizeWhatsAppMessageConfig(config);
  const { kind, custom } = resolveTemplateKind(next, key);
  const preferredLanguage = next.metaLanguage?.trim() || 'es';
  const existingMeta =
    kind === 'appointment'
      ? next.appointmentMeta?.[key as AppointmentTemplateKey]
      : custom?.meta;
  const metaName = resolveMetaNameForKey(next, key, kind, custom);
  const metaTemplate =
    kind === 'appointment'
      ? resolveAppointmentCatalogMetaTemplate(
          metaTemplates,
          key as AppointmentTemplateKey,
          existingMeta,
          preferredLanguage,
        )
      : findMetaTemplateByCandidates(
          metaTemplates,
          [existingMeta?.name, metaName],
          preferredLanguage,
          { prefixBases: [metaName, existingMeta?.name] },
        );
  if (!metaTemplate) {
    return config;
  }

  const meta: WhatsAppTemplateMetaState = {
    ...existingMeta,
    name: metaTemplate.name,
    language: metaTemplate.language,
    category:
      (metaTemplate.category as WhatsAppTemplateMetaState['category']) ??
      existingMeta?.category ??
      'UTILITY',
    status: normalizeMetaStatus(metaTemplate.status) ?? existingMeta?.status,
    metaTemplateId: metaTemplate.id ?? existingMeta?.metaTemplateId,
    lastRegisteredAt: existingMeta?.lastRegisteredAt,
    lastError: existingMeta?.lastError,
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
