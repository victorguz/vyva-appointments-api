export type WhatsAppMetaCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export interface MetaTemplateConversion {
  metaBody: string;
  bodyExamples: string[];
  variableCount: number;
}

export interface MetaTemplateValidation {
  valid: boolean;
  errors: string[];
}

const VYVA_VAR_NAME = String.raw`[\p{L}_][\p{L}\p{N}_]*`;
export const VYVA_VAR_PATTERN = new RegExp(String.raw`\{\{(${VYVA_VAR_NAME})\}\}`, 'gu');
const ANY_VYVA_PLACEHOLDER = /\{\{([^}]*)\}\}/g;

function isValidVyvaVariableName(name: string): boolean {
  return new RegExp(`^${VYVA_VAR_NAME}$`, 'u').test(name);
}

function hasInvalidVyvaPlaceholders(body: string): boolean {
  for (const match of body.matchAll(ANY_VYVA_PLACEHOLDER)) {
    if (!isValidVyvaVariableName(match[1])) {
      return true;
    }
  }
  return false;
}

const DEFAULT_EXAMPLES: Record<string, string> = {
  customerName: 'Valery',
  serviceName: 'Limpieza Facial',
  employeeName: 'Ana Martínez',
  date: 'miércoles, 25 de dic.',
  startTime: '02:30 PM',
  endTime: '03:30 PM',
  greeting: 'buenos días',
  time: '02:30 PM',
  unreadCount: '8',
  orderNumber: '#1247',
  totalAmount: '$285.000',
};

export function convertVyvaBodyToMeta(
  body: string,
  examples?: Partial<Record<string, string>>,
): MetaTemplateConversion {
  const mergedExamples = { ...DEFAULT_EXAMPLES, ...examples };
  const seen = new Map<string, number>();
  const bodyExamples: string[] = [];

  const metaBody = body.replace(VYVA_VAR_PATTERN, (_match, varName: string) => {
    if (!seen.has(varName)) {
      const index = seen.size + 1;
      seen.set(varName, index);
      bodyExamples.push(mergedExamples[varName] ?? 'ejemplo');
    }
    return `{{${seen.get(varName)}}}`;
  });

  return {
    metaBody,
    bodyExamples,
    variableCount: seen.size,
  };
}

export function validateMetaTemplateBody(metaBody: string): MetaTemplateValidation {
  const errors: string[] = [];

  const trimmed = metaBody.trim();
  if (!trimmed) {
    errors.push('El mensaje no puede estar vacío.');
    return { valid: false, errors };
  }

  if (metaBody.length > 1024) {
    errors.push('El mensaje supera 1024 caracteres (límite de Meta).');
  }

  if (/^\{\{\d+\}\}/.test(trimmed)) {
    errors.push('El mensaje no puede empezar con una variable.');
  }
  if (/\{\{\d+\}\}$/.test(trimmed)) {
    errors.push('El mensaje no puede terminar con una variable.');
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(metaBody)) {
    errors.push('No puede haber dos variables seguidas sin texto entre medio.');
  }

  const numbers = [...metaBody.matchAll(/\{\{(\d+)\}\}/g)].map((m) =>
    Number(m[1]),
  );
  for (let i = 0; i < numbers.length; i++) {
    if (numbers[i] !== i + 1) {
      errors.push('Las variables deben ser secuenciales ({{1}}, {{2}}, …).');
      break;
    }
  }

  if (/\{\{[^}\d][^}]*\}\}/.test(metaBody)) {
    errors.push(
      'Revisa el formato de las variables. Usa {{nombre}} con letras, números o guión bajo (por ejemplo {{cliente}} o {{precio_total}}).',
    );
  }

  return { valid: errors.length === 0, errors };
}

export function validateVyvaTemplateBody(body: string): MetaTemplateValidation {
  const trimmed = body.trim();
  if (!trimmed) {
    return { valid: false, errors: ['El mensaje no puede estar vacío.'] };
  }

  if (hasInvalidVyvaPlaceholders(trimmed)) {
    return {
      valid: false,
      errors: [
        'Revisa el formato de las variables. Usa {{nombre}} con letras, números o guión bajo (por ejemplo {{cliente}} o {{precio_total}}).',
      ],
    };
  }

  const conversion = convertVyvaBodyToMeta(trimmed);
  return validateMetaTemplateBody(conversion.metaBody);
}

export function countMetaTemplateVariables(metaBody: string): number {
  const matches = metaBody.match(/\{\{\d+\}\}/g) ?? [];
  if (matches.length === 0) {
    return 0;
  }
  return Math.max(...matches.map((match) => Number(match.replace(/\D/g, ''))));
}

export function normalizeMetaTemplateLanguage(language?: string): string {
  const normalized = language?.trim().replace('_', '-') ?? '';
  if (!normalized) {
    return 'es';
  }
  if (/^[a-z]{2}(-[A-Za-z]{2})?$/.test(normalized)) {
    return normalized;
  }
  return 'es';
}

export function sanitizeMetaTemplateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 512);
}

export function generateShortMetaTemplateUid(length = 6): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return result;
}

export function buildMetaTemplateFallbackName(baseName: string): string {
  const sanitized = sanitizeMetaTemplateName(baseName);
  const suffix = `_${generateShortMetaTemplateUid()}`;
  const maxBaseLength = Math.max(1, 512 - suffix.length);
  return `${sanitized.slice(0, maxBaseLength)}${suffix}`;
}

export function collectRelatedMetaTemplateNames(
  baseName: string,
  metaTemplates: Array<{ name: string }> | null | undefined,
  extraNames: Array<string | undefined> = [],
): string[] {
  const prefix = sanitizeMetaTemplateName(baseName);
  const names = new Set<string>([prefix]);

  for (const rawName of extraNames) {
    if (rawName?.trim()) {
      names.add(sanitizeMetaTemplateName(rawName));
    }
  }

  for (const template of metaTemplates ?? []) {
    if (template.name === prefix || template.name.startsWith(`${prefix}_`)) {
      names.add(template.name);
    }
  }

  return [...names];
}

export function isValidMetaTemplateName(name: string): boolean {
  const sanitized = sanitizeMetaTemplateName(name);
  return sanitized.length > 0 && /^[a-z][a-z0-9_]*$/.test(sanitized);
}

/** Replaces Meta placeholders {{1}}, {{2}}, … with parameter values. */
export function formatTemplateBody(
  templateBody: string,
  parameters: string[],
): string {
  let text = templateBody;
  parameters.forEach((param, index) => {
    text = text.replace(
      new RegExp(`\\{\\{\\s*${index + 1}\\s*\\}\\}`, 'g'),
      param ?? '',
    );
  });
  return text;
}
