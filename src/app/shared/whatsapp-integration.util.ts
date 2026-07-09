import { WhatsAppIntegrationData } from '../schemas/integration.schema';
import {
  integrationRowTimestamp,
  listDuplicateIntegrationRows,
} from './integration-business.util';

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
    metaPaymentMethodConfirmed: data.metaPaymentMethodConfirmed,
    useCredentials: data.useCredentials,
    useSystemUserTokenForPhoneVerification:
      data.useSystemUserTokenForPhoneVerification,
    twoStepPin: data.twoStepPin
      ? String(data.twoStepPin).trim() || undefined
      : undefined,
    metaEmbeddedSignup: data.metaEmbeddedSignup,
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
  const incomingHasFullCredentials =
    !hasMaskedWhatsAppCredentials(incoming) &&
    !!String(incoming.phoneNumberId ?? '').trim() &&
    !!String(incoming.accessToken ?? '').trim() &&
    !!String(incoming.appSecret ?? '').trim();

  const base = incomingHasFullCredentials
    ? { ...incoming }
    : { ...existing, ...incoming };

  return normalizeWhatsAppIntegrationData({
    ...base,
    phoneNumberId: isPlaceholderPhoneNumberId(incoming.phoneNumberId)
      ? existing.phoneNumberId
      : String(
          incoming.phoneNumberId ??
            (base as WhatsAppIntegrationData).phoneNumberId ??
            '',
        ).trim(),
    accessToken: isPlaceholderSecret(incoming.accessToken)
      ? existing.accessToken
      : String(
          incoming.accessToken ??
            (base as WhatsAppIntegrationData).accessToken ??
            '',
        ).trim(),
    appSecret: isPlaceholderSecret(incoming.appSecret)
      ? existing.appSecret
      : String(
          incoming.appSecret ?? (base as WhatsAppIntegrationData).appSecret ?? '',
        ).trim(),
  } as WhatsAppIntegrationData);
}

function isWhatsAppPreferenceOnlyUpdate(
  incoming: Partial<WhatsAppIntegrationData>,
): boolean {
  const hasPreferenceUpdate =
    incoming.useCredentials !== undefined ||
    incoming.useSystemUserTokenForPhoneVerification !== undefined;

  if (!hasPreferenceUpdate) {
    return false;
  }

  const credentialFieldsProvided =
    incoming.phoneNumberId !== undefined ||
    incoming.accessToken !== undefined ||
    incoming.appSecret !== undefined ||
    incoming.phoneRegistered !== undefined ||
    incoming.metaPaymentMethodConfirmed !== undefined ||
    incoming.metaEmbeddedSignup !== undefined;

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
    if (!existing) {
      throw new Error('MS042');
    }
    return mergeWhatsAppIntegrationData(existing, incoming);
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

/** Prefer a row with real credentials over preference-only shells. */
export function selectCanonicalWhatsAppIntegrationRow<
  T extends {
    id: string;
    isActive: boolean;
    updatedAt?: Date;
    createdAt?: Date;
  },
>(rows: T[], isConfiguredRow: (row: T) => boolean): T | null {
  if (!rows?.length) {
    return null;
  }

  return [...rows].sort((a, b) => {
    const aConfigured = isConfiguredRow(a);
    const bConfigured = isConfiguredRow(b);
    if (aConfigured !== bConfigured) {
      return aConfigured ? -1 : 1;
    }
    if (a.isActive !== b.isActive) {
      return a.isActive ? -1 : 1;
    }
    return integrationRowTimestamp(b) - integrationRowTimestamp(a);
  })[0];
}

export { listDuplicateIntegrationRows };
