import {
  convertVyvaBodyToMeta,
  countMetaTemplateVariables,
} from './whatsapp-template.util';

export interface CampaignTemplateParameterValidation {
  valid: boolean;
  message?: string;
  missingFields?: string[];
}

export function resolveTemplateVariableCount(templateBody?: string): number {
  const body = templateBody?.trim();
  if (!body) {
    return 0;
  }

  const numbered = countMetaTemplateVariables(body);
  if (numbered > 0) {
    return numbered;
  }

  return convertVyvaBodyToMeta(body).variableCount;
}

/** Ensures every template variable has a non-empty value before calling Meta. */
export function validateCampaignTemplateParameters(
  bodyParameters: string[],
  options?: {
    bodyFieldMapping?: string[];
    templateBody?: string;
  },
): CampaignTemplateParameterValidation {
  const mapping = (options?.bodyFieldMapping ?? []).map((field) => field?.trim() ?? '');
  const fromTemplate = resolveTemplateVariableCount(options?.templateBody);
  const slotCount = Math.max(
    fromTemplate,
    mapping.length,
    bodyParameters.length,
  );

  if (slotCount === 0) {
    return { valid: true };
  }

  const missingFields: string[] = [];
  for (let index = 0; index < slotCount; index++) {
    const value = bodyParameters[index]?.trim() ?? '';
    if (!value) {
      missingFields.push(mapping[index] || `parámetro ${index + 1}`);
    }
  }

  if (missingFields.length === 0) {
    return { valid: true };
  }

  const message =
    missingFields.length === 1
      ? `Falta valor para el campo "${missingFields[0]}" requerido por la plantilla.`
      : `Faltan valores para los campos: ${missingFields.join(', ')}.`;

  return { valid: false, message, missingFields };
}
