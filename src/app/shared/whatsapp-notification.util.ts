export const WHATSAPP_NOTIFICATION_SETTINGS_GROUP = 'whatsappNotificationSettings';

export const NOTIFICATION_TEMPLATE_KEYS = {
  unansweredMessages: 'unanswered_messages',
  sales: 'sales_notification',
} as const;

export type NotificationTemplateKey =
  (typeof NOTIFICATION_TEMPLATE_KEYS)[keyof typeof NOTIFICATION_TEMPLATE_KEYS];

export const NOTIFICATION_META_TEMPLATE_NAMES: Record<
  NotificationTemplateKey,
  string
> = {
  [NOTIFICATION_TEMPLATE_KEYS.unansweredMessages]: 'vyva_unanswered_messages',
  [NOTIFICATION_TEMPLATE_KEYS.sales]: 'vyva_sales_notification',
};

export interface AppointmentReminderScheduleConfig {
  timing: 'before' | 'after';
  mode: 'immediate' | 'hours' | 'dayAtTime';
  hours?: number;
  minutes?: number;
  dayAtTime?: string;
}

export const MAX_APPOINTMENT_REMINDER_HOURS = 168;
export const DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME = '09:00';

const APPOINTMENT_REMINDER_STATUS_KEYS = [
  'pending',
  'confirmed',
  'completed',
] as const;

type AppointmentReminderStatusKey =
  (typeof APPOINTMENT_REMINDER_STATUS_KEYS)[number];

type AppointmentReminderStatuses = Record<
  AppointmentReminderStatusKey,
  AppointmentReminderScheduleConfig
>;

const DEFAULT_APPOINTMENT_REMINDER_SCHEDULE: AppointmentReminderStatuses = {
  pending: {
    timing: 'before',
    mode: 'dayAtTime',
    dayAtTime: DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
  },
  confirmed: {
    timing: 'before',
    mode: 'dayAtTime',
    dayAtTime: DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
  },
  completed: {
    timing: 'after',
    mode: 'hours',
    hours: 0.05,
  },
};

type LegacyAppointmentReminderTemplates = Partial<
  Record<
    'booking' | 'pending' | 'confirmed' | 'completed' | 'web',
    { hoursBefore?: number }
  >
>;

export interface WhatsAppNotificationSettings {
  recipientPhones: string[];
  sendOnlyToRecipientPhones: boolean;
  useOwnWhatsAppAccount: boolean;
  unansweredMessages: {
    enabled: boolean;
  };
  appointmentReminders: {
    enabled: boolean;
    statuses: AppointmentReminderStatuses;
  };
  sales: {
    enabled: boolean;
  };
  onboardingCompleted?: boolean;
}

export const DEFAULT_WHATSAPP_NOTIFICATION_SETTINGS: WhatsAppNotificationSettings =
  {
    recipientPhones: [],
    sendOnlyToRecipientPhones: false,
    useOwnWhatsAppAccount: true,
    unansweredMessages: {
      enabled: false,
    },
    appointmentReminders: {
      enabled: false,
      statuses: { ...DEFAULT_APPOINTMENT_REMINDER_SCHEDULE },
    },
    sales: {
      enabled: false,
    },
  };

export interface NotificationTemplateButton {
  type: 'URL' | 'QUICK_REPLY';
  text: string;
  url?: string;
}

export interface NotificationTemplateDefinition {
  key: NotificationTemplateKey;
  metaName: string;
  title: string;
  description: string;
  header?: string;
  body: string;
  footer?: string;
  buttons?: NotificationTemplateButton[];
}

export function buildUnansweredMessagesTemplateHeader(): string {
  return 'Mensajes pendientes';
}

export function buildUnansweredMessagesTemplateBody(): string {
  return (
    'Tienes {{unreadCount}} mensajes de WhatsApp sin responder.\n\n' +
    'Tus clientes están esperando respuesta. Atender a tiempo mejora tu conversión ' +
    'y la confianza en tu negocio.\n\n' +
    '👉 Responde lo antes posible.'
  );
}

export function buildUnansweredMessagesTemplateFooter(): string {
  return 'Notificación Vyva';
}

export function buildSalesNotificationTemplateHeader(): string {
  return 'Nueva venta registrada';
}

export function buildSalesNotificationTemplateBody(): string {
  return (
    '📋 *Orden:* {{orderNumber}}\n' +
    '👤 *Cliente:* {{customerName}}\n' +
    '💵 *Total:* {{totalAmount}}\n\n' +
    'Usa el enlace para ver el detalle de la venta.'
  );
}

export function buildSalesNotificationTemplateFooter(): string {
  return 'Revisa el pedido en Vyva.';
}

export function buildNotificationTemplateDefinitions(
  urls: { chatUrl: string; salesUrl: string },
): Record<NotificationTemplateKey, NotificationTemplateDefinition> {
  return {
    [NOTIFICATION_TEMPLATE_KEYS.unansweredMessages]: {
      key: NOTIFICATION_TEMPLATE_KEYS.unansweredMessages,
      metaName:
        NOTIFICATION_META_TEMPLATE_NAMES[NOTIFICATION_TEMPLATE_KEYS.unansweredMessages],
      title: 'Mensajes sin responder',
      description:
        'Aviso interno cuando hay varios mensajes de WhatsApp pendientes de respuesta.',
      header: buildUnansweredMessagesTemplateHeader(),
      body: buildUnansweredMessagesTemplateBody(),
      footer: buildUnansweredMessagesTemplateFooter(),
      buttons: [
        {
          type: 'URL',
          text: 'Ir al chat',
          url: urls.chatUrl,
        },
      ],
    },
    [NOTIFICATION_TEMPLATE_KEYS.sales]: {
      key: NOTIFICATION_TEMPLATE_KEYS.sales,
      metaName: NOTIFICATION_META_TEMPLATE_NAMES[NOTIFICATION_TEMPLATE_KEYS.sales],
      title: 'Notificación de venta',
      description:
        'Aviso interno cuando se registra una nueva venta en el negocio.',
      header: buildSalesNotificationTemplateHeader(),
      body: buildSalesNotificationTemplateBody(),
      footer: buildSalesNotificationTemplateFooter(),
      buttons: [
        {
          type: 'URL',
          text: 'Ver la orden',
          url: urls.salesUrl,
        },
      ],
    },
  };
}

function normalizeMinutes(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(2, Math.round(parsed));
}

function normalizeHours(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }
  if (parsed === 0) {
    return 0;
  }
  const clamped = Math.min(MAX_APPOINTMENT_REMINDER_HOURS, parsed);
  return Math.round(clamped * 100) / 100;
}

function normalizeDayAtTime(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value.trim())) {
    return fallback;
  }
  return value.trim();
}

function normalizeAppointmentReminderScheduleConfig(
  status: AppointmentReminderStatusKey,
  raw?: Partial<AppointmentReminderScheduleConfig> | { hoursBefore?: number } | null,
  legacyHours?: unknown,
): AppointmentReminderScheduleConfig {
  const defaults = DEFAULT_APPOINTMENT_REMINDER_SCHEDULE[status];
  const legacyHoursBefore =
    typeof raw === 'object' && raw && 'hoursBefore' in raw
      ? raw.hoursBefore
      : legacyHours;

  if (
    status === 'completed' &&
    legacyHoursBefore !== undefined &&
    (!raw || !('mode' in raw) || raw.mode === undefined)
  ) {
    return {
      timing: 'after',
      mode: 'hours',
      hours: normalizeHours(undefined, defaults.hours ?? 0.05),
    };
  }

  if (
    legacyHoursBefore !== undefined &&
    (!raw || !('mode' in raw) || raw.mode === undefined)
  ) {
    return {
      timing: defaults.timing,
      mode: 'dayAtTime',
      dayAtTime: normalizeDayAtTime(
        undefined,
        defaults.dayAtTime ?? DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
      ),
    };
  }

  const config = (raw ?? {}) as Partial<AppointmentReminderScheduleConfig>;

  const rawMode =
    status === 'completed' && config.mode === 'immediate'
      ? 'hours'
      : config.mode;

  const mode =
    rawMode === 'immediate' ||
    rawMode === 'hours' ||
    rawMode === 'dayAtTime'
      ? rawMode
      : defaults.mode;

  if (mode === 'immediate') {
    return {
      timing: status === 'completed' ? 'after' : 'before',
      mode: 'immediate',
      minutes: normalizeMinutes(config.minutes, defaults.minutes ?? 2),
    };
  }

  if (mode === 'dayAtTime') {
    return {
      timing: status === 'completed' ? 'after' : 'before',
      mode: 'dayAtTime',
      dayAtTime: normalizeDayAtTime(
        config.dayAtTime,
        defaults.dayAtTime ?? DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
      ),
    };
  }

  return {
    timing: status === 'completed' ? 'after' : 'before',
    mode: 'hours',
    hours: normalizeHours(
      config.hours,
      defaults.hours ?? (status === 'completed' ? 0.05 : 1),
    ),
    dayAtTime: defaults.dayAtTime,
  };
}

function buildDefaultAppointmentReminderStatuses(): AppointmentReminderStatuses {
  return { ...DEFAULT_APPOINTMENT_REMINDER_SCHEDULE };
}

function normalizeAppointmentReminderStatuses(
  raw?: Partial<AppointmentReminderStatuses> | null,
  legacy?: {
    hoursBefore?: unknown;
    templates?: LegacyAppointmentReminderTemplates;
  },
): AppointmentReminderStatuses {
  const legacyTemplates = legacy?.templates;
  const statuses = buildDefaultAppointmentReminderStatuses();

  for (const key of APPOINTMENT_REMINDER_STATUS_KEYS) {
    const legacyTemplateHours =
      key === 'pending'
        ? legacyTemplates?.pending?.hoursBefore ??
          legacyTemplates?.booking?.hoursBefore
        : legacyTemplates?.[key]?.hoursBefore;

    statuses[key] = normalizeAppointmentReminderScheduleConfig(
      key,
      raw?.[key],
      legacy?.hoursBefore ?? legacyTemplateHours,
    );
  }

  return statuses;
}

export function normalizeWhatsAppNotificationSettings(
  raw?: Partial<WhatsAppNotificationSettings> | null,
): WhatsAppNotificationSettings {
  const legacyUnanswered = raw?.unansweredMessages as
    | { enabled?: boolean; recipientPhones?: string[] }
    | undefined;

  const legacyPhones = [
    ...(raw?.recipientPhones ?? []),
    ...(legacyUnanswered?.recipientPhones ?? []),
  ]
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return {
    recipientPhones: [...new Set(legacyPhones)],
    sendOnlyToRecipientPhones: raw?.sendOnlyToRecipientPhones === true,
    useOwnWhatsAppAccount: raw?.useOwnWhatsAppAccount !== false,
    unansweredMessages: {
      enabled: raw?.unansweredMessages?.enabled === true,
    },
    appointmentReminders: {
      enabled: raw?.appointmentReminders?.enabled === true,
      statuses: normalizeAppointmentReminderStatuses(
        raw?.appointmentReminders?.statuses as
          | Partial<AppointmentReminderStatuses>
          | undefined,
        {
          hoursBefore: (
            raw?.appointmentReminders as { hoursBefore?: unknown } | undefined
          )?.hoursBefore,
          templates: (
            raw?.appointmentReminders as {
              templates?: LegacyAppointmentReminderTemplates;
            }
          )?.templates,
        },
      ),
    },
    sales: {
      enabled: raw?.sales?.enabled === true,
    },
    onboardingCompleted: raw?.onboardingCompleted === true,
  };
}
