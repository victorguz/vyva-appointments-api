import { Schema } from 'dynamoose';

import { PaymentMethodType } from '../core/constants/domain.constants';

export interface SalesOrderKey {
  orderNumber?: string;
  id?: string;
}

export interface SalesOrderItem {
  id: string;
  name?: string;
  price?: number;
  offerPrice?: number;
  quantity: number;
  commission?: number;
}

export interface SalesOrderPaymentMethod {
  value: number;
  type: PaymentMethodType;
}

export interface SalesOrder extends SalesOrderKey {
  idBusiness?: string;
  idCustomer?: string;
  orderNumber: string;
  products: SalesOrderItem[];
  paymentMethods: SalesOrderPaymentMethod[];

  /** monto total de la orden sin descuentos aplicados */
  subTotalAmount: number;
  /** monto total de la orden con descuentos aplicados */
  totalAmount: number;
  /** monto pagado por el cliente */
  paidAmount: number;

  status: string;
  createdBy?: string;
  modifiedBy?: string;
  createdAt: Date;
  updatedAt: Date;

  // data for statistics

  /** descuentos totales del total amount */
  totalDiscounts: number;
  /** descuentos pagados del total amount */
  paidDiscounts: number;

  /** Comisiones totales del total amount */
  totalCommissions: number;
  /** comisiones pagadas del total amount */
  paidCommissions: number;

  /** ingresos totales de la orden: lo que se gana por la venta */
  totalIncome: number;
  /** ingresos pagados de la orden: lo que se gana por la venta pagado por el cliente */
  paidIncome: number;
  /** costos totales de la orden: lo que se gasta por la venta */
  totalCosts: number;
  /** costos pagados de la orden: lo que se gasta por la venta pagado por el cliente */
  paidCosts: number;
}

export interface SalesOrderListResponse {
  salesOrders: SalesOrder[];
  totalPages: number;
  totalItems: number;
  lastKey?: string;
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
    subTotalAmount: {
      type: Number,
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
    idBusiness: {
      type: String,
      required: false,
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

    totalDiscounts: {
      type: Number,
      required: false,
    },
    totalCommissions: {
      type: Number,
      required: false,
    },
    totalIncome: {
      type: Number,
      required: false,
    },
    totalCosts: {
      type: Number,
      required: false,
    },
    paidDiscounts: {
      type: Number,
      required: false,
    },
    paidCommissions: {
      type: Number,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);
