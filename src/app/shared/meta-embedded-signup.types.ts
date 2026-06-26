/** Raw Meta API payloads captured after Embedded Signup (tokens redacted in exchange steps). */
export interface MetaEmbeddedSignupSnapshot {
  connectedAt: string;
  oauthAccessTokenExchange?: Record<string, unknown>;
  longLivedTokenExchange?: Record<string, unknown>;
  debugToken?: Record<string, unknown>;
  wabaIds: string[];
  selectedWabaId: string;
  phoneNumbersListing?: Record<string, unknown>;
  selectedPhoneNumberId: string;
  phoneNumberDetails?: Record<string, unknown>;
  /** Whether our Meta app was subscribed to the WABA webhooks (subscribed_apps). */
  appSubscribed?: boolean;
  appSubscriptionError?: string;
}

export function redactMetaAccessTokenPayload(
  payload: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!payload) {
    return undefined;
  }

  const copy = { ...payload };
  if (typeof copy.access_token === 'string') {
    copy.access_token = '[stored in integration.accessToken]';
  }
  return copy;
}
