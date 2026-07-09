import { normalizeColombiaWaPhone } from './shared.functions';

export interface WhatsAppInboundSenderIdentity {
  /** E.164 phone or BSUID used as conversation key when phone is unavailable. */
  waPhone: string;
  waUserId?: string;
  waUsername?: string;
  displayName?: string;
}

export interface WhatsAppMessageRecipient {
  phone?: string;
  userId?: string;
}

/** Meta BSUID (e.g. US.13491208655302741918 or parent US.ENT.xxx). */
export function isWhatsAppBsuid(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return /^[A-Z]{2}\./i.test(trimmed);
}

export function resolveWhatsAppMessageRecipient(input: {
  waPhone?: string;
  waUserId?: string;
}): WhatsAppMessageRecipient {
  const stored = input.waPhone?.trim() ?? '';
  const userId =
    input.waUserId?.trim() ||
    (isWhatsAppBsuid(stored) ? stored : undefined);

  const phone =
    stored && !isWhatsAppBsuid(stored)
      ? normalizeColombiaWaPhone(stored)
      : '';

  if (phone) {
    return { phone, ...(userId ? { userId } : {}) };
  }
  if (userId) {
    return { userId };
  }
  return {};
}

export function resolveInboundSenderIdentity(
  msg: Record<string, unknown>,
  value: Record<string, unknown>,
): WhatsAppInboundSenderIdentity | null {
  const contacts =
    (value.contacts as Array<{
      wa_id?: string;
      user_id?: string;
      profile?: { name?: string; username?: string };
    }>) ?? [];

  const fromUserId = String(msg.from_user_id ?? '').trim() || undefined;
  const fromRaw = String(msg.from ?? '').trim();

  let fromPhone = '';
  if (fromRaw && !isWhatsAppBsuid(fromRaw)) {
    fromPhone = normalizeColombiaWaPhone(fromRaw);
  }

  let contact = contacts.find((entry) => {
    if (fromPhone && entry.wa_id) {
      return normalizeColombiaWaPhone(String(entry.wa_id)) === fromPhone;
    }
    if (fromUserId && entry.user_id) {
      return String(entry.user_id).trim() === fromUserId;
    }
    return false;
  });
  if (!contact && contacts.length === 1) {
    contact = contacts[0];
  }

  const waUserId = fromUserId || contact?.user_id?.trim() || undefined;
  const contactWaId = contact?.wa_id ? String(contact.wa_id).trim() : '';
  const contactPhone =
    contactWaId && !isWhatsAppBsuid(contactWaId)
      ? normalizeColombiaWaPhone(contactWaId)
      : '';

  const waPhone = fromPhone || contactPhone || waUserId || '';
  if (!waPhone) {
    return null;
  }

  const waUsername = contact?.profile?.username?.trim() || undefined;
  const profileName = contact?.profile?.name?.trim() || undefined;
  const displayName = profileName || waUsername;

  return {
    waPhone,
    waUserId,
    waUsername,
    displayName,
  };
}
