import { Schema } from 'dynamoose';

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

export enum IntegrationType {
  WHATSAPP = 'whatsapp',
}

export interface WhatsAppIntegrationData {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
  phoneRegistered?: boolean;
  /** Onboarding step: user confirmed Meta Business payment method for WABA. */
  metaPaymentMethodConfirmed?: boolean;
  /** Manual credentials flow (onboarding toggle) vs Meta OAuth. */
  useCredentials?: boolean;
  /** Step 2: use server META_SYSTEM_USER_ACCESS_TOKEN instead of client OAuth token. */
  useSystemUserTokenForPhoneVerification?: boolean;
  /**
   * Two-step verification PIN that Vyva generates and sends to Cloud API
   * /register. Stored encrypted so it can be reused on re-registration.
   */
  twoStepPin?: string;
  /** Meta API responses captured after Embedded Signup. */
  metaEmbeddedSignup?: MetaEmbeddedSignupSnapshot;
}

export interface IntegrationKey {
  id?: string;
}

export interface Integration extends IntegrationKey {
  id: string;
  type: IntegrationType | string;
  userId: string;
  idBusiness: string;
  data: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export const IntegrationSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    type: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'type-index',
      },
    },
    userId: {
      type: String,
      required: true,
    },
    idBusiness: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'idBusiness-index',
      },
    },
    data: {
      type: String,
      required: true,
    },
    isActive: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);
