import { Schema } from 'dynamoose';

import { PaymentMethodType } from '../core/constants/domain.constants';

export interface SalesOrderKey {
  orderNumber?: string;
  id?: string;
}

export interface SalesOrderItem {
  id: string;
  quantity: number;
  isSubscription?: boolean;
  price: number;
  offerPrice?: number;
}

export interface SalesOrderPaymentMethod {
  value: number;
  type: PaymentMethodType;
}

export interface SalesOrder extends SalesOrderKey {
  orderNumber: string;
  idCustomer: string;
  products: SalesOrderItem[];
  paymentMethods: SalesOrderPaymentMethod[];
  totalAmount: number;
  status: string;
  businessInfoId?: string;
  createdBy?: string;
  modifiedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export const SalesOrderSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    orderNumber: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'orderNumber-index',
      },
    },
    idCustomer: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'customer-index',
      },
    },
    products: {
      type: Array,
      schema: [
        {
          type: Object,
          schema: {
            id: { type: String, required: true },
            quantity: { type: Number, required: true },
            isSubscription: { type: Boolean, required: true },
            price: { type: Number, required: true },
            offerPrice: { type: Number, required: false },
          },
        },
      ],
      required: true,
    },
    paymentMethods: {
      type: Array,
      schema: [
        {
          type: Object,
          schema: {
            value: { type: Number, required: true },
            type: {
              type: String,
              required: true,
            },
          },
        },
      ],
      required: true,
    },
    totalAmount: {
      type: Number,
      required: true,
    },
    paidAmount: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      required: true,
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

