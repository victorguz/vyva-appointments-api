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

  if (metaBody.length > 1024) {
    errors.push('El mensaje supera 1024 caracteres (límite de Meta).');
  }

  const trimmed = metaBody.trim();
  if (/^\{\{\d+\}\}/.test(trimmed)) {
    errors.push('El mensaje no puede empezar con una variable.');
  }
  if (/\{\{\d+\}\}$/.test(trimmed)) {
    errors.push('El mensaje no puede terminar con una variable.');
  }
  if (/\{\{\d+\}\}\s*\{\{\d+\}\}/.test(metaBody)) {
    errors.push('No puede haber dos variables seguidas sin texto entre medio.');
  }

  return { valid: errors.length === 0, errors };
}

export function sanitizeMetaTemplateName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 512);
}
