import { Schema } from 'dynamoose';

import { AppointmentStatus } from '../core/constants/domain.constants';

export interface AppointmentKey {
  id?: string;
}

export interface AppointmentService {
  id: string;
  name: string;
  price?: number;
  offerPrice?: number;
  measure?: number;
}

export interface Appointment extends AppointmentKey {
  id: string;
  startDate: Date;
  endDate: Date;
  idService?: string; // Kept for backwards compatibility
  idCustomer?: string;
  idEmployee?: string;
  idOrder?: string;
  status: AppointmentStatus;
  idBusiness?: string;
  createdBy?: string;
  modifiedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
  googleCalendarId?: string;
  /** Single event id (legacy) or JSON array string: [{ role: 'employee'|'customer', eventId: string }, ...] */
  googleCalendarEventId?: string;
  googleCalendarEmployeeEventId?: string;
  googleCalendarCustomerEventId?: string;
  // New fields for multiple services and cached names
  customerName?: string;
  serviceName?: string;
  employeeName?: string;
  notes?: string;
  services?: AppointmentService[]; // Array of services for this appointment
  idParent?: string; // ID of the parent appointment (for multi-session series)
  sessionNumber?: number; // 1-based session index within the series
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
      required: false,
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
      enum: Object.values(AppointmentStatus), // Includes timeOut
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
    googleCalendarId: {
      type: String,
      required: false,
    },
    googleCalendarEventId: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'googleEvent-index',
      },
    },
    googleCalendarEmployeeEventId: {
      type: String,
      required: false,
    },
    googleCalendarCustomerEventId: {
      type: String,
      required: false,
    },
    customerName: {
      type: String,
      required: false,
    },
    serviceName: {
      type: String,
      required: false,
    },
    employeeName: {
      type: String,
      required: false,
    },
    notes: {
      type: String,
      required: false,
    },
    services: {
      type: Array,
      schema: [
        {
          type: Object,
          schema: {
            id: { type: String, required: true },
            name: { type: String, required: true },
            price: { type: Number, required: false },
            offerPrice: { type: Number, required: false },
            measure: { type: Number, required: false },
          },
        },
      ],
      required: false,
    },
    idParent: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'parent-index',
      },
    },
    sessionNumber: {
      type: Number,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);
