export type WhatsAppMetaCategory = 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

export type WhatsAppTemplateMetaStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'PAUSED';

export type WhatsAppTemplateButtonType = 'URL' | 'QUICK_REPLY';

export interface WhatsAppTemplateButton {
  type: WhatsAppTemplateButtonType;
  text: string;
  url?: string;
}

export interface WhatsAppTemplateLayout {
  header?: string;
  footer?: string;
  buttons?: WhatsAppTemplateButton[];
}

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
  header?: string;
  footer?: string;
  buttons?: WhatsAppTemplateButton[];
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
  appointmentTemplateLayout?: Partial<
    Record<'booking' | 'pending' | 'confirmed' | 'completed', WhatsAppTemplateLayout>
  >;
  appointmentMeta?: Partial<
    Record<'booking' | 'pending' | 'confirmed' | 'completed', WhatsAppTemplateMetaState>
  >;
}

export interface MetaTemplateSyncSource {
  id?: string;
  name: string;
  language: string;
  category?: string;
  status?: string;
  preview: string;
}
