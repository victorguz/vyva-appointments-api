import { Schema } from 'dynamoose';

export interface WhatsAppConversationKey {
  id: string;
}

export interface WhatsAppConversation extends WhatsAppConversationKey {
  idBusiness: string;
  waPhone: string;
  idCustomer?: string;
  displayName?: string;
  waUserId?: string;
  /** WhatsApp @username from webhook contacts[].profile.username. */
  waUsername?: string;
  lastMessageAt: number;
  lastMessagePreview?: string;
  /** Last inbound (customer) message timestamp (ms). Drives the 24h service window. */
  lastInboundAt?: number;
  /** Inbound messages not yet read by the business in the app. */
  unreadCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const WhatsAppConversationSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    idBusiness: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'idBusiness-lastMessageAt-index',
        rangeKey: 'lastMessageAt',
      },
    },
    waPhone: {
      type: String,
      required: true,
    },
    idCustomer: {
      type: String,
      required: false,
    },
    displayName: {
      type: String,
      required: false,
    },
    waUserId: {
      type: String,
      required: false,
    },
    waUsername: {
      type: String,
      required: false,
    },
    lastMessageAt: {
      type: Number,
      required: true,
    },
    lastMessagePreview: {
      type: String,
      required: false,
    },
    lastInboundAt: {
      type: Number,
      required: false,
    },
    unreadCount: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);
