import { Schema } from 'dynamoose';

export interface DomainKey {
  id: string;
}

export interface Domain extends DomainKey {
  idBusiness: string;
  name: string;
  group?: string;
  value?: string;
  description?: string;
  isActive?: boolean;
  order?: number;
  createdAt: Date;
  updatedAt: Date;
}

export const DomainSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    idBusiness: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'domain-idBusinessid-index',
      },
    },
    name: {
      type: String,
      required: true,
    },
    group: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'domain-group-index',
      },
    },
    value: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
    },
    isActive: {
      type: Boolean,
      required: false,
      default: true,
    },
    order: {
      type: Number,
      required: false,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
);
