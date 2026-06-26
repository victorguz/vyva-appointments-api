export type WhatsAppMetaCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export type WhatsAppTemplateMetaStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED';

export interface WhatsAppTemplateMetaState {
  name: string;
  language: string;
  category: WhatsAppMetaCategory;
  status?: WhatsAppTemplateMetaStatus;
  metaTemplateId?: string;
  lastRegisteredAt?: number;
  lastError?: string;
}

export interface WhatsAppTemplateItem {
  key: string;
  kind: 'appointment' | 'custom';
  title: string;
  description: string;
  body: string;
  metaCategory: WhatsAppMetaCategory;
  meta?: WhatsAppTemplateMetaState;
}

export interface WhatsAppMessageConfig {
  dateFormat: string;
  timeFormat: string;
  messages: {
    pending: string;
    confirmed: string;
    completed: string;
    booking: string;
  };
  metaLanguage?: string;
  customTemplates?: WhatsAppTemplateItem[];
  appointmentMeta?: Partial<
    Record<'booking' | 'pending' | 'confirmed' | 'completed', WhatsAppTemplateMetaState>
  >;
}

export interface MetaTemplateSyncSource {
  name: string;
  language: string;
  category?: string;
  status?: string;
  preview: string;
}
