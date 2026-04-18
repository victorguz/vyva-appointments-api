import { Schema } from 'dynamoose';

export interface BusinessKey {
  id: string;
}

export interface Business extends BusinessKey {
  idUser: string;
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
  facebook?: string;
  instagram?: string;
  tiktok?: string;
  whatsapp?: string;
  area?: string;
  isPhysicalAttention?: boolean;
  isActive?: boolean;
  createdAt: Date;
  updatedAt: Date;
  coverImages?: string[];
}

export const BusinessSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    idUser: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'idUser-index',
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
    facebook: {
      type: String,
      required: false,
    },
    instagram: {
      type: String,
      required: false,
    },
    tiktok: {
      type: String,
      required: false,
    },
    whatsapp: {
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
    area: {
      type: String,
      required: false,
    },
    isPhysicalAttention: {
      type: Boolean,
      required: false,
    },
    coverImages: {
      type: Array,
      schema: [String],
      required: false,
    },
  },
  {
    timestamps: true,
  },
);
