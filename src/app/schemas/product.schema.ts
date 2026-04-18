import { Schema } from 'dynamoose';

import {
  MeasurementUnits,
  ProductStatus,
} from '../core/constants/domain.constants';

export interface ProductKey {
  id: string;
}

export interface Product extends ProductKey {
  name: string;
  image?: string | null;
  description?: string;
  measure: number;

  unit: MeasurementUnits;
  sku?: string;
  status: ProductStatus;
  isService: boolean;
  isSubscription: boolean;
  requireStock?: boolean;
  /**Precio de venta */
  price?: number;
  /**Precio de oferta */
  offerPrice?: number;
  /**Precio de costo */
  costPrice?: number;
  /**Comisiones */
  commissions?: number;
  /**Stock / cantidad disponible*/
  stock?: number;
  idBusiness: string;
  categories?: string[];
  createdBy?: string;
  modifiedBy?: string;
  createdAt: Date;
  updatedAt: Date;
  type: string;
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
      default: 0,
    },
    costPrice: {
      type: Number,
      required: false,
      default: 0,
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
    isService: {
      type: Boolean,
      required: true,
    },
    isSubscription: {
      type: Boolean,
      required: true,
      default: false,
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
    idBusiness: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'idBusiness-index',
      },
    },
    categories: {
      type: Array,
      schema: [String],
      required: false,
      default: [],
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
