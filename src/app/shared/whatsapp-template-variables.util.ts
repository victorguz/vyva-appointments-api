import * as moment from 'moment';
import 'moment/locale/es';

import {
  AppointmentTemplateKey,
  APPOINTMENT_META_TEMPLATE_NAMES,
} from './whatsapp-message-config.util';
import { WhatsAppMessageConfig } from './whatsapp-message-config.types';
import { convertVyvaBodyToMeta, VYVA_VAR_PATTERN } from './whatsapp-template.util';

export interface AppointmentTemplateContext {
  customerName?: string;
  serviceName?: string;
  employeeName?: string;
  startDate: Date | string | number;
  endDate?: Date | string | number;
  greetingAt?: Date | string | number;
}

/** Accepts Date, epoch ms (number or numeric string), or ISO date strings. */
export function coerceAppointmentDate(
  value: Date | string | number | undefined | null,
): Date | null {
  if (value == null || value === '') {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const raw = String(value).trim();
  if (/^\d+$/.test(raw)) {
    const date = new Date(Number(raw));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Converts Angular DatePipe patterns (domain config) to moment.js tokens. */
export function angularDateFormatToMoment(format: string): string {
  let result = '';
  let index = 0;

  while (index < format.length) {
    if (format[index] === "'") {
      const end = format.indexOf("'", index + 1);
      const literal =
        end === -1 ? format.slice(index + 1) : format.slice(index + 1, end);
      result += `[${literal}]`;
      index = end === -1 ? format.length : end + 1;
      continue;
    }

    if (format.slice(index, index + 4) === 'EEEE') {
      result += 'dddd';
      index += 4;
      continue;
    }

    if (format.slice(index, index + 3) === 'EEE') {
      result += 'ddd';
      index += 3;
      continue;
    }

    if (format.slice(index, index + 4) === 'yyyy') {
      result += 'YYYY';
      index += 4;
      continue;
    }

    if (format.slice(index, index + 2) === 'dd') {
      result += 'DD';
      index += 2;
      continue;
    }

    if (format[index] === 'd') {
      result += 'D';
      index += 1;
      continue;
    }

    if (format.slice(index, index + 3) === 'MMM') {
      result += 'MMM';
      index += 3;
      continue;
    }

    if (format.slice(index, index + 2) === 'MM') {
      result += 'MM';
      index += 2;
      continue;
    }

    result += format[index];
    index += 1;
  }

  return result;
}

const VYVA_DEFAULT_TIMEZONE = 'America/Bogota';

export function getVyvaLocalHour(
  date: Date,
  timeZone = VYVA_DEFAULT_TIMEZONE,
): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((part) => part.type === 'hour');
  return Number(hourPart?.value ?? 0);
}

export function buildAppointmentGreeting(
  date: Date,
  timeZone = VYVA_DEFAULT_TIMEZONE,
): string {
  const hour = getVyvaLocalHour(date, timeZone);
  if (hour >= 6 && hour < 12) {
    return 'buenos días';
  }
  if (hour >= 12 && hour < 19) {
    return 'buenas tardes';
  }
  return 'buenas noches';
}

/**
 * Converts a UTC Date to a "virtual local Date" in the given timezone.
 * The resulting Date object has the same wall-clock time as the local timezone
 * but expressed as UTC, so moment.js formats it without any additional offset.
 */
function toVyvaLocalDate(
  date: Date,
  timeZone = VYVA_DEFAULT_TIMEZONE,
): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }

  // hour12:false can yield '24' for midnight — normalize to '00'
  const hour = p['hour'] === '24' ? '00' : p['hour'];
  return new Date(
    `${p['year']}-${p['month']}-${p['day']}T${hour}:${p['minute']}:${p['second']}Z`,
  );
}

export function formatVyvaDate(
  date: Date,
  dateFormat = "EEEE, d 'de' MMM",
  timeZone = VYVA_DEFAULT_TIMEZONE,
): string {
  return moment(toVyvaLocalDate(date, timeZone))
    .locale('es')
    .format(angularDateFormatToMoment(dateFormat));
}

export function formatVyvaTime(
  date: Date,
  timeFormat = 'hh:mm a',
  timeZone = VYVA_DEFAULT_TIMEZONE,
): string {
  return moment(toVyvaLocalDate(date, timeZone)).locale('es').format(timeFormat);
}

export function buildAppointmentTemplateVariables(
  config: WhatsAppMessageConfig,
  context: AppointmentTemplateContext,
): Record<string, string> {
  const startDate = coerceAppointmentDate(context.startDate);
  if (!startDate) {
    throw new RangeError(
      `Invalid appointment startDate: ${String(context.startDate)}`,
    );
  }
  const endDate = coerceAppointmentDate(context.endDate) ?? startDate;
  const greetingDate = coerceAppointmentDate(context.greetingAt) ?? new Date();
  const startTime = formatVyvaTime(startDate, config.timeFormat);

  return {
    customerName: context.customerName?.trim() || 'Cliente',
    serviceName: context.serviceName?.trim() || 'tu servicio',
    employeeName: context.employeeName?.trim() || 'nuestro equipo',
    date: formatVyvaDate(startDate, config.dateFormat),
    startTime,
    endTime: formatVyvaTime(endDate, config.timeFormat),
    time: startTime,
    greeting: buildAppointmentGreeting(greetingDate),
  };
}

export function extractVyvaVariableOrder(templateBody: string): string[] {
  const order: string[] = [];
  const seen = new Set<string>();

  for (const match of templateBody.matchAll(VYVA_VAR_PATTERN)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      order.push(name);
    }
  }

  return order;
}

export function buildMetaBodyParametersFromVyvaTemplate(
  templateBody: string,
  variables: Record<string, string>,
): string[] {
  return extractVyvaVariableOrder(templateBody).map(
    (name) => variables[name] ?? '',
  );
}

export function resolveAppointmentTemplateKeyFromName(
  templateName: string,
): AppointmentTemplateKey | null {
  const entry = (
    Object.entries(APPOINTMENT_META_TEMPLATE_NAMES) as [
      AppointmentTemplateKey,
      string,
    ][]
  ).find(([, metaName]) => metaName === templateName);

  return entry?.[0] ?? null;
}

export function resolveAppointmentTemplateBody(
  config: WhatsAppMessageConfig,
  templateKey: AppointmentTemplateKey,
): string {
  return config.messages[templateKey] ?? '';
}

export function buildAppointmentTemplateSendPayload(
  config: WhatsAppMessageConfig,
  templateKey: AppointmentTemplateKey,
  context: AppointmentTemplateContext,
): { bodyParameters: string[]; templateBody: string; metaBody: string } {
  const templateBody = resolveAppointmentTemplateBody(config, templateKey);
  const variables = buildAppointmentTemplateVariables(config, context);
  const conversion = convertVyvaBodyToMeta(templateBody, variables);

  return {
    bodyParameters: buildMetaBodyParametersFromVyvaTemplate(
      templateBody,
      variables,
    ),
    templateBody,
    metaBody: conversion.metaBody,
  };
}
