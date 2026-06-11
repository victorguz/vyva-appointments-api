import { Schema } from 'dynamoose';

export interface WhatsAppConversationKey {
  id: string;
}

export interface WhatsAppConversation extends WhatsAppConversationKey {
  idBusiness: string;
  waPhone: string;
  idCustomer?: string;
  displayName?: string;
  lastMessageAt: number;
  lastMessagePreview?: string;
  /** Last inbound (customer) message timestamp (ms). Drives the 24h service window. */
  lastInboundAt?: number;
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
  },
  {
    timestamps: true,
  },
);
