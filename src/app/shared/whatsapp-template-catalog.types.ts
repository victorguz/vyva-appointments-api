import {
  WhatsAppMetaCategory,
  WhatsAppTemplateMetaState,
  WhatsAppTemplateMetaStatus,
} from './whatsapp-message-config.types';

export interface WhatsAppTemplateMetaSnapshot {
  exists: boolean;
  name?: string;
  status?: WhatsAppTemplateMetaStatus;
  language?: string;
  category?: string;
  body?: string;
  bodyParameterCount?: number;
}

export interface WhatsAppTemplateCatalogItem {
  key: string;
  kind: 'appointment' | 'custom';
  title: string;
  description: string;
  meta: WhatsAppTemplateMetaSnapshot | null;
}

export interface WhatsAppTemplateEditorDetail {
  key: string;
  kind: 'appointment' | 'custom';
  dateFormat: string;
  timeFormat: string;
  metaLanguage: string;
  title: string;
  description: string;
  metaCategory: WhatsAppMetaCategory;
  displayBody: string;
  domainBody: string;
  meta: WhatsAppTemplateMetaSnapshot | null;
  appointmentMeta?: WhatsAppTemplateMetaState;
}

export interface WhatsAppTemplateSaveResult {
  key: string;
  kind: 'appointment' | 'custom';
  displayBody: string;
  domainBody: string;
  meta: WhatsAppTemplateMetaSnapshot | null;
  metaRegistered: boolean;
  metaError?: string;
  appointmentMeta?: WhatsAppTemplateMetaState;
}

export interface SaveWhatsAppTemplatePayload {
  body: string;
  title?: string;
  description?: string;
  metaCategory?: WhatsAppMetaCategory;
  dateFormat?: string;
  timeFormat?: string;
  metaLanguage?: string;
}
