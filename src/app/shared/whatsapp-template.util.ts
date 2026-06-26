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

const VYVA_VAR_PATTERN = /\{\{(\w+)\}\}/g;

const DEFAULT_EXAMPLES: Record<string, string> = {
  customerName: 'Valery',
  serviceName: 'Limpieza Facial',
  employeeName: 'Ana Martínez',
  date: '25/12/2024',
  startTime: '02:30 PM',
  endTime: '03:30 PM',
  greeting: 'buenos días',
  time: '02:30 PM',
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
      'El mensaje contiene variables con formato inválido. Usa las variables de Vyva (por ejemplo {{customerName}}).',
    );
  }

  return { valid: errors.length === 0, errors };
}

export function validateVyvaTemplateBody(body: string): MetaTemplateValidation {
  const conversion = convertVyvaBodyToMeta(body);
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
