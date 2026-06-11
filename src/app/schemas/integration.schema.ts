import { Schema } from 'dynamoose';

export enum IntegrationType {
  WHATSAPP = 'whatsapp',
}

export interface WhatsAppIntegrationData {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string;
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
