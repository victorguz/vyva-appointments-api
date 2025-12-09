import { Schema } from 'dynamoose';

import { MeasurementUnits, ProductStatus } from '../core/constants/domain.constants';

export interface ProductKey {
  id: string;
}

export interface Product extends ProductKey {
  name: string;
  image?: string | null;
  description?: string;
  measure: number;
  commissions?: number;
  unit: MeasurementUnits;
  sku?: string;
  status: ProductStatus;
  isService: boolean;
  isSubscription: boolean;
  subscriptionDays?: number;
  requireStock?: boolean;
  price?: number;
  offerPrice?: number;
  stock?: number;
  businessInfoId: string;
  createdBy?: string;
  modifiedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const ProductSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    name: {
      type: String,
      required: true,
    },
    image: {
      type: String,
      required: false,
      default: null,
    },
    description: {
      type: String,
      required: false,
    },
    measure: {
      type: Number,
      required: true,
    },
    commissions: {
      type: Number,
      required: false,
    },
    unit: {
      type: String,
      enum: Object.values(MeasurementUnits),
      required: true,
      default: MeasurementUnits.und,
    },
    sku: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'sku-index',
      },
    },
    status: {
      type: String,
      enum: Object.values(ProductStatus),
      required: true,
      default: ProductStatus.draft,
    },
    isSubscription: {
      type: Boolean,
      required: true,
    },
    subscriptionDays: {
      type: Number,
      required: false,
    },
    isService:{
      type: Boolean,
      required: true,
    },
    requireStock: {
      type: Boolean,
      required: false,
      default: false,
    },
    price: {
      type: Number,
      required: false,
    },
    offerPrice: {
      type: Number,
      required: false,
    },
    stock: {
      type: Number,
      required: false,
      default: 0,
    },
    businessInfoId: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'businessInfo-index',
      },
    },
    createdBy: {
      type: String,
      required: false,
    },
    modifiedBy: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);

