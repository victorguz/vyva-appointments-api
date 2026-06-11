export const WHATSAPP_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ServiceWindowState {
  serviceWindowOpen: boolean;
  serviceWindowExpiresAt?: number;
}

export function getServiceWindowState(
  lastInboundAt?: number | null,
  now = Date.now(),
): ServiceWindowState {
  if (!lastInboundAt) {
    return { serviceWindowOpen: false };
  }

  const serviceWindowExpiresAt = lastInboundAt + WHATSAPP_SERVICE_WINDOW_MS;
  return {
    serviceWindowOpen: now < serviceWindowExpiresAt,
    serviceWindowExpiresAt,
  };
}

export function withServiceWindow<T extends { lastInboundAt?: number }>(
  conversation: T,
  now = Date.now(),
): T & ServiceWindowState {
  return {
    ...conversation,
    ...getServiceWindowState(conversation.lastInboundAt, now),
  };
}
