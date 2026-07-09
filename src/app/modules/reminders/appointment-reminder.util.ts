import * as moment from 'moment-timezone';

import {
  APPOINTMENT_REMINDER_STATUS_KEYS,
  AppointmentReminderStatusKey,
  AppointmentStatus,
} from '../../core/constants/domain.constants';
import { Appointment } from '../../schemas/appointment.schema';

export const REMINDER_TYPE_APPOINTMENT = 'appointment' as const;

export type AppointmentReminderTiming = 'before' | 'after';
export type AppointmentReminderScheduleMode = 'immediate' | 'hours' | 'dayAtTime';

export interface AppointmentReminderScheduleConfig {
  timing: AppointmentReminderTiming;
  mode: AppointmentReminderScheduleMode;
  hours?: number;
  minutes?: number;
  dayAtTime?: string;
}

export const MIN_APPOINTMENT_REMINDER_MINUTES = 2;
export const MAX_APPOINTMENT_REMINDER_HOURS = 168;
export const DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME = '09:00';

export const DEFAULT_APPOINTMENT_REMINDER_SCHEDULE: Record<
  AppointmentReminderStatusKey,
  AppointmentReminderScheduleConfig
> = {
  [AppointmentStatus.pending]: {
    timing: 'before',
    mode: 'dayAtTime',
    dayAtTime: DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
  },
  [AppointmentStatus.confirmed]: {
    timing: 'before',
    mode: 'dayAtTime',
    dayAtTime: DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
  },
  [AppointmentStatus.completed]: {
    timing: 'after',
    mode: 'hours',
    hours: 0.05,
  },
};

export const APPOINTMENT_BOOKING_TEMPLATE = 'vyva_appointment_booking';
export const APPOINTMENT_PENDING_TEMPLATE = 'vyva_appointment_pending';
export const APPOINTMENT_CONFIRMED_TEMPLATE = 'vyva_appointment_confirmed';
export const APPOINTMENT_COMPLETED_TEMPLATE = 'vyva_appointment_completed';

export type AppointmentTemplateMetaKey =
  | 'booking'
  | 'pending'
  | 'confirmed'
  | 'completed';

const CANONICAL_TEMPLATE_META_KEYS: Record<string, AppointmentTemplateMetaKey> =
  {
    [APPOINTMENT_BOOKING_TEMPLATE]: 'booking',
    [APPOINTMENT_PENDING_TEMPLATE]: 'pending',
    [APPOINTMENT_CONFIRMED_TEMPLATE]: 'confirmed',
    [APPOINTMENT_COMPLETED_TEMPLATE]: 'completed',
  };

export function resolveAppointmentTemplateMetaKey(
  templateName: string,
): AppointmentTemplateMetaKey | null {
  return CANONICAL_TEMPLATE_META_KEYS[templateName] ?? null;
}

export const PRE_COMPLETION_REMINDER_STATUS_KEYS: AppointmentReminderStatusKey[] =
  [AppointmentStatus.pending, AppointmentStatus.confirmed];

const STATUS_TEMPLATE_NAMES: Partial<Record<AppointmentStatus, string>> = {
  [AppointmentStatus.pending]: APPOINTMENT_PENDING_TEMPLATE,
  [AppointmentStatus.confirmed]: APPOINTMENT_CONFIRMED_TEMPLATE,
  [AppointmentStatus.completed]: APPOINTMENT_COMPLETED_TEMPLATE,
};

const PRE_COMPLETION_REMINDER_TEMPLATES = new Set<string>([
  APPOINTMENT_PENDING_TEMPLATE,
  APPOINTMENT_CONFIRMED_TEMPLATE,
]);

export { APPOINTMENT_REMINDER_STATUS_KEYS, AppointmentReminderStatusKey };

export interface AppointmentReminderNotificationSettings {
  appointmentReminders: {
    enabled: boolean;
    statuses?: Partial<
      Record<AppointmentReminderStatusKey, AppointmentReminderScheduleConfig>
    >;
    templates?: Partial<
      Record<
        AppointmentReminderStatusKey | 'booking',
        { hoursBefore?: number }
      >
    >;
    hoursBefore?: number;
  };
}

const NON_SCHEDULABLE_STATUSES = new Set<AppointmentStatus>([
  AppointmentStatus.canceled,
  AppointmentStatus.canceledByCustomer,
  AppointmentStatus.timeOut,
]);

export function mapAppointmentStatusToReminderScheduleKey(
  status: AppointmentStatus,
): AppointmentReminderStatusKey {
  if (status === AppointmentStatus.web) {
    return AppointmentStatus.pending;
  }
  if (
    APPOINTMENT_REMINDER_STATUS_KEYS.includes(
      status as AppointmentReminderStatusKey,
    )
  ) {
    return status as AppointmentReminderStatusKey;
  }
  return AppointmentStatus.pending;
}

export function shouldSendScheduledAppointmentReminder(
  appointment: Appointment,
  template: string,
  options?: { allowWithoutCustomer?: boolean },
): boolean {
  if (!appointment.idBusiness) {
    return false;
  }
  if (!options?.allowWithoutCustomer && !appointment.idCustomer) {
    return false;
  }
  if (NON_SCHEDULABLE_STATUSES.has(appointment.status)) {
    return false;
  }
  if (PRE_COMPLETION_REMINDER_TEMPLATES.has(template)) {
    return appointment.status !== AppointmentStatus.completed;
  }
  if (template === APPOINTMENT_COMPLETED_TEMPLATE) {
    return appointment.status === AppointmentStatus.completed;
  }
  return false;
}

export function buildAppointmentReminderId(
  idAppointment: string,
  recipient: string,
  statusKey: AppointmentReminderStatusKey,
): string {
  return `appointment:${idAppointment}:${recipient}:${statusKey}`;
}

export function buildBookingReminderId(
  idAppointment: string,
  recipient: string,
): string {
  return `appointment:${idAppointment}:${recipient}:booking`;
}

export function resolveAppointmentReminderTemplate(
  status: AppointmentStatus,
): string | null {
  return STATUS_TEMPLATE_NAMES[status] ?? null;
}

export function shouldScheduleAppointmentReminder(
  appointment: Appointment,
): boolean {
  if (!appointment.idBusiness) {
    return false;
  }
  if (NON_SCHEDULABLE_STATUSES.has(appointment.status)) {
    return false;
  }
  return true;
}

function normalizeMinutes(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(MIN_APPOINTMENT_REMINDER_MINUTES, Math.round(parsed));
}

function normalizeHours(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  // Allow 0 for "right after completed"; reject only negatives / NaN.
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

function fixedTimingForStatus(
  status: AppointmentReminderStatusKey,
): AppointmentReminderTiming {
  return status === AppointmentStatus.completed ? 'after' : 'before';
}

export function normalizeAppointmentReminderScheduleConfig(
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
    status === AppointmentStatus.completed &&
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
    status === AppointmentStatus.completed && config.mode === 'immediate'
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
      timing: fixedTimingForStatus(status),
      mode: 'immediate',
      minutes: normalizeMinutes(
        config.minutes,
        defaults.minutes ?? MIN_APPOINTMENT_REMINDER_MINUTES,
      ),
    };
  }

  if (mode === 'dayAtTime') {
    return {
      timing: fixedTimingForStatus(status),
      mode: 'dayAtTime',
      dayAtTime: normalizeDayAtTime(
        config.dayAtTime,
        defaults.dayAtTime ?? DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
      ),
    };
  }

  return {
    timing: fixedTimingForStatus(status),
    mode: 'hours',
    hours: normalizeHours(
      config.hours,
      defaults.hours ??
        (status === AppointmentStatus.completed ? 0.05 : 1),
    ),
    dayAtTime: defaults.dayAtTime,
  };
}

export function resolveReminderScheduleForStatus(
  status: AppointmentStatus,
  settings: AppointmentReminderNotificationSettings | null,
): AppointmentReminderScheduleConfig {
  const legacy = settings?.appointmentReminders?.hoursBefore;
  const legacyTemplates = settings?.appointmentReminders?.templates;
  const statuses = settings?.appointmentReminders?.statuses;
  const statusKey = mapAppointmentStatusToReminderScheduleKey(status);

  const legacyTemplateHours =
    statusKey === AppointmentStatus.pending
      ? legacyTemplates?.pending?.hoursBefore ??
        legacyTemplates?.booking?.hoursBefore
      : legacyTemplates?.[statusKey]?.hoursBefore;

  return normalizeAppointmentReminderScheduleConfig(
    statusKey,
    statuses?.[statusKey],
    legacy ?? legacyTemplateHours,
  );
}

function parseDayAtTime(value: string): { hour: number; minute: number } {
  const [hourRaw, minuteRaw] = value.split(':');
  return {
    hour: Number(hourRaw) || 0,
    minute: Number(minuteRaw) || 0,
  };
}

function computeDayAtTimeBefore(startDate: Date, dayAtTime: string): Date {
  const { hour, minute } = parseDayAtTime(dayAtTime);
  return moment(startDate)
    .subtract(1, 'day')
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0)
    .toDate();
}

function computeDayAtTimeAfter(endDate: Date, dayAtTime: string): Date {
  const { hour, minute } = parseDayAtTime(dayAtTime);
  return moment(endDate)
    .add(1, 'day')
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0)
    .toDate();
}

export function computeAppointmentReminderSendDate(
  appointment: Pick<Appointment, 'startDate' | 'endDate'>,
  config: AppointmentReminderScheduleConfig,
  scheduleStatusKey?: AppointmentReminderStatusKey,
): Date {
  const start = moment(appointment.startDate);
  const end = moment(appointment.endDate ?? appointment.startDate);

  // Completed notifications are anchored to the moment the appointment is marked
  // completed (now), not to the scheduled endDate of the appointment.
  if (scheduleStatusKey === AppointmentStatus.completed) {
    if (config.mode === 'dayAtTime') {
      return computeDayAtTimeAfter(
        new Date(),
        config.dayAtTime ?? DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
      );
    }
    if (config.mode === 'immediate') {
      return moment()
        .add(
          normalizeMinutes(config.minutes, MIN_APPOINTMENT_REMINDER_MINUTES),
          'minutes',
        )
        .toDate();
    }
    return moment()
      .add(normalizeHours(config.hours, 0.05), 'hours')
      .toDate();
  }

  if (config.mode === 'immediate') {
    return moment()
      .add(normalizeMinutes(config.minutes, MIN_APPOINTMENT_REMINDER_MINUTES), 'minutes')
      .toDate();
  }

  if (config.timing === 'before') {
    if (config.mode === 'hours') {
      return start
        .clone()
        .subtract(normalizeHours(config.hours, 1), 'hours')
        .toDate();
    }
    return computeDayAtTimeBefore(
      start.toDate(),
      config.dayAtTime ?? DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
    );
  }

  if (config.mode === 'hours') {
    return end
      .clone()
      .add(normalizeHours(config.hours, 24), 'hours')
      .toDate();
  }

  return computeDayAtTimeAfter(
    end.toDate(),
    config.dayAtTime ?? DEFAULT_APPOINTMENT_REMINDER_DAY_AT_TIME,
  );
}

export function resolveStatusReminderSendDate(
  appointment: Pick<Appointment, 'startDate' | 'endDate'>,
  statusKey: AppointmentReminderStatusKey,
  settings: AppointmentReminderNotificationSettings | null,
): Date | null {
  const template = resolveAppointmentReminderTemplate(statusKey);
  if (!template) {
    return null;
  }

  const schedule = resolveReminderScheduleForStatus(statusKey, settings);
  const sendDate = computeAppointmentReminderSendDate(
    appointment,
    schedule,
    statusKey,
  );

  if (isReminderSendDateInFuture(sendDate)) {
    return sendDate;
  }

  // Completed: if the computed delay already elapsed (e.g. hours=0), due now.
  if (statusKey === AppointmentStatus.completed) {
    return new Date();
  }

  if (
    statusKey === AppointmentStatus.confirmed &&
    moment(appointment.startDate).isAfter(moment())
  ) {
    return moment()
      .add(MIN_APPOINTMENT_REMINDER_MINUTES, 'minutes')
      .toDate();
  }

  return null;
}

export function isReminderSendDateInFuture(sendDate: Date): boolean {
  return sendDate.getTime() > Date.now();
}

/** Unix epoch seconds for the due-window range key (status-expiresAt-index). */
export function toReminderExpiresAtSeconds(sendDate: Date): number {
  return Math.floor(sendDate.getTime() / 1000);
}
