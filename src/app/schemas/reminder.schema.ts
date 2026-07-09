import { Schema } from 'dynamoose';

export type ReminderType = 'appointment';

export type ReminderChannel = 'whatsapp' | 'email';

export type ReminderStatus = 'pending' | 'queued';

export interface ReminderKey {
  id: string;
}

export interface Reminder extends ReminderKey {
  type: ReminderType;
  idReference: string;
  template: string;
  recipient: string;
  channel: ReminderChannel;
  sendDate: Date;
  /** Unix epoch seconds aligned with sendDate; range key on status-expiresAt-index. */
  expiresAt: number;
  /** Dispatch lifecycle: pending -> queued (deleted after enqueue). */
  status?: ReminderStatus;
  idBusiness?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

export const ReminderSchema = new Schema(
  {
    id: {
      type: String,
      hashKey: true,
      required: true,
    },
    type: {
      type: String,
      required: true,
      enum: ['appointment'],
      index: {
        type: 'global',
        name: 'type-idReference-index',
        rangeKey: 'idReference',
      },
    },
    idReference: {
      type: String,
      required: true,
    },
    template: {
      type: String,
      required: true,
    },
    recipient: {
      type: String,
      required: true,
    },
    channel: {
      type: String,
      required: true,
      enum: ['whatsapp', 'email'],
    },
    sendDate: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      required: false,
      default: 'pending',
      enum: ['pending', 'queued'],
      index: {
        type: 'global',
        name: 'status-expiresAt-index',
        rangeKey: 'expiresAt',
      },
    },
    idBusiness: {
      type: String,
      required: false,
    },
  },
  {
    timestamps: true,
  },
);
