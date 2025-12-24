import { Schema } from 'dynamoose';

export interface BusinessKey {
  id: string;
}

export interface Business extends BusinessKey {
  userId: string;
  name?: string;
  description?: string;
  slogan?: string;
  taxId?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  logo?: string;
  slug: string;
  isActive?: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export const BusinessSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    userId: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'userId-index',
      },
    },
    name: {
      type: String,
      required: false,
    },
    description: {
      type: String,
      required: false,
    },
    slogan: {
      type: String,
      required: false,
    },
    taxId: {
      type: String,
      required: false,
    },
    address: {
      type: String,
      required: false,
    },
    phone: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: false,
    },
    website: {
      type: String,
      required: false,
    },
    logo: {
      type: String,
      required: false,
    },
    slug: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'business-slug-index',
      },
    },
    isActive: {
      type: Boolean,
      required: false,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);
