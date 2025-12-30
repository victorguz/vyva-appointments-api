import { Schema } from 'dynamoose';

import { AppointmentStatus } from '../core/constants/domain.constants';

export interface AppointmentKey {
  id?: string;
}

export interface Appointment extends AppointmentKey {
  id: string;
  startDate: Date;
  endDate: Date;
  idService: string;
  idCustomer?: string;
  idEmployee?: string;
  idOrder?: string;
  status: AppointmentStatus;
  idBusiness?: string;
  createdBy?: string;
  modifiedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const AppointmentSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    idService: {
      type: String,
      required: true,
    },
    idCustomer: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'customer-index',
      },
    },
    idEmployee: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'employee-index',
      },
    },
    idOrder: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'order-index',
      },
    },
    status: {
      type: String,
      required: true,
      enum: Object.values(AppointmentStatus),
      index: {
        type: 'global',
        name: 'status-index',
      },
    },
    idBusiness: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'idBusiness-index',
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
