import { Schema } from 'dynamoose';

export interface CustomerKey {
  id: string;
}

export interface Customer extends CustomerKey {
  firstName: string;
  lastName?: string;
  email?: string;
  role?: string;
  status?: boolean;
  documentType?: string;
  documentNumber?: string;
  phone?: string;
  typePerson?: string;
  gender?: string;
  dateOfBirth?: string;
  country?: string;
  city?: string;
  address?: string;
  profilePicture?: string;
  userId?: string;
  businessId: string;
  data?: any;
  createdAt: Date;
  updatedAt: Date;
}

export const CustomerSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    firstName: {
      type: String,
      required: true,
    },
    lastName: {
      type: String,
      required: false,
    },
    email: {
      type: String,
      required: false,
      index: {
        type: 'global',
        name: 'customer-email-index',
      },
    },
    role: {
      type: String,
      required: false,
      default: 'customer',
    },
    status: {
      type: Boolean,
      default: true,
      required: false,
    },
    documentType: {
      type: String,
      required: false,
      default: '',
    },
    documentNumber: {
      type: String,
      required: false,
      default: '',
    },
    phone: {
      type: String,
      required: false,
    },
    typePerson: {
      type: String,
      required: false,
      default: 'natural',
    },
    gender: {
      type: String,
      required: false,
    },
    dateOfBirth: {
      type: String,
      required: false,
    },
    country: {
      type: String,
      required: false,
    },
    city: {
      type: String,
      required: false,
    },
    address: {
      type: String,
      required: false,
    },
    profilePicture: {
      type: String,
      required: false,
    },
    userId: {
      type: String,
      required: false,
    },
    businessId: {
      type: String,
      required: true,
      index: {
        type: 'global',
        name: 'customer-businessid-index',
      },
    },
    data: {
      type: Object,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);
