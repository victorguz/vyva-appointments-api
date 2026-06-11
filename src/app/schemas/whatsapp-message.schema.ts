import { Schema } from 'dynamoose';

export type WhatsAppMessageDirection = 'inbound' | 'outbound';
export type WhatsAppMessageStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export interface WhatsAppMessageKey {
  id: string;
}

export interface WhatsAppMessage extends WhatsAppMessageKey {
  idConversation: string;
  idBusiness: string;
  idCustomer?: string;
  metaMessageId?: string;
  clientMessageId?: string;
  direction: WhatsAppMessageDirection;
  waPhone: string;
  type: string;
  body?: string;
  payload?: string;
  status: WhatsAppMessageStatus;
  timestamp: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export const WhatsAppMessageSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    idConversation: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'idConversation-timestamp-index',
        rangeKey: 'timestamp',
      },
    },
    idBusiness: {
      type: String,
      required: true,
    },
    idCustomer: {
      type: String,
      required: false,
    },
    metaMessageId: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'metaMessageId-index',
      },
    },
    clientMessageId: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'clientMessageId-index',
      },
    },
    direction: {
      type: String,
      required: true,
    },
    waPhone: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      required: true,
      default: 'text',
    },
    body: {
      type: String,
      required: false,
    },
    payload: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      required: true,
      default: 'pending',
    },
    timestamp: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);
