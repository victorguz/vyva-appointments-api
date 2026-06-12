import { WhatsAppIntegrationData } from '../schemas/integration.schema';

/** Mask returned to the frontend when credentials already exist server-side. */
export const WHATSAPP_CREDENTIAL_MASK = '********';

export function isPlaceholderSecret(value: unknown): boolean {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return true;
  }
  return normalized === WHATSAPP_CREDENTIAL_MASK || /^\*+$/.test(normalized);
}

export function isPlaceholderPhoneNumberId(value: unknown): boolean {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return true;
  }
  if (isPlaceholderSecret(normalized)) {
    return true;
  }
  return normalized.includes('*');
}

export function hasMaskedWhatsAppCredentials(
  data: Partial<WhatsAppIntegrationData> | null | undefined,
): boolean {
  if (!data) {
    return true;
  }

  return (
    isPlaceholderPhoneNumberId(data.phoneNumberId) ||
    isPlaceholderSecret(data.accessToken) ||
    isPlaceholderSecret(data.appSecret)
  );
}

export function normalizeWhatsAppIntegrationData(
  data: WhatsAppIntegrationData,
): WhatsAppIntegrationData {
  return {
    ...data,
    phoneNumberId: String(data.phoneNumberId ?? '').trim(),
    accessToken: String(data.accessToken ?? '').trim(),
    appSecret: String(data.appSecret ?? '').trim(),
    phoneRegistered: data.phoneRegistered,
    useCredentials: data.useCredentials,
  };
}

export function isWhatsAppConfigured(
  data: WhatsAppIntegrationData | null | undefined,
): boolean {
  if (!data) {
    return false;
  }

  const normalized = normalizeWhatsAppIntegrationData(data);
  if (hasMaskedWhatsAppCredentials(normalized)) {
    return false;
  }

  return !!(
    normalized.phoneNumberId &&
    normalized.accessToken &&
    normalized.appSecret
  );
}

/** Merge client payload, preserving real secrets when masked placeholders are sent. */
export function mergeWhatsAppIntegrationData(
  existing: WhatsAppIntegrationData,
  incoming: Partial<WhatsAppIntegrationData>,
): WhatsAppIntegrationData {
  return normalizeWhatsAppIntegrationData({
    phoneNumberId: isPlaceholderPhoneNumberId(incoming.phoneNumberId)
      ? existing.phoneNumberId
      : String(incoming.phoneNumberId ?? '').trim(),
    accessToken: isPlaceholderSecret(incoming.accessToken)
      ? existing.accessToken
      : String(incoming.accessToken ?? '').trim(),
    appSecret: isPlaceholderSecret(incoming.appSecret)
      ? existing.appSecret
      : String(incoming.appSecret ?? '').trim(),
    phoneRegistered: incoming.phoneRegistered ?? existing.phoneRegistered,
    useCredentials: incoming.useCredentials ?? existing.useCredentials,
  });
}

function isWhatsAppPreferenceOnlyUpdate(
  incoming: Partial<WhatsAppIntegrationData>,
): boolean {
  if (incoming.useCredentials === undefined) {
    return false;
  }

  const credentialFieldsProvided =
    incoming.phoneNumberId !== undefined ||
    incoming.accessToken !== undefined ||
    incoming.appSecret !== undefined ||
    incoming.phoneRegistered !== undefined;

  if (credentialFieldsProvided && !hasMaskedWhatsAppCredentials(incoming)) {
    return false;
  }

  return !credentialFieldsProvided || hasMaskedWhatsAppCredentials(incoming);
}

export function resolveWhatsAppIntegrationDataForSave(
  incoming: Partial<WhatsAppIntegrationData>,
  existing: WhatsAppIntegrationData | null,
): WhatsAppIntegrationData {
  if (isWhatsAppPreferenceOnlyUpdate(incoming)) {
    return existing
      ? mergeWhatsAppIntegrationData(existing, incoming)
      : normalizeWhatsAppIntegrationData({
          phoneNumberId: '',
          accessToken: '',
          appSecret: '',
          useCredentials: incoming.useCredentials,
        });
  }

  const resolved = existing
    ? mergeWhatsAppIntegrationData(existing, incoming)
    : normalizeWhatsAppIntegrationData(incoming as WhatsAppIntegrationData);

  if (!existing && hasMaskedWhatsAppCredentials(resolved)) {
    throw new Error('MS042');
  }

  if (!isWhatsAppConfigured(resolved)) {
    throw new Error('MS042');
  }

  return resolved;
}
