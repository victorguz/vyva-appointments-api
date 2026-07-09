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
  domainHeader?: string;
  domainFooter?: string;
  domainButtons?: Array<{
    type: 'URL' | 'QUICK_REPLY';
    text: string;
    url?: string;
  }>;
  meta: WhatsAppTemplateMetaSnapshot | null;
  appointmentMeta?: WhatsAppTemplateMetaState;
}

export interface WhatsAppTemplateSaveResult {
  key: string;
  kind: 'appointment' | 'custom';
  displayBody: string;
  domainBody: string;
  domainHeader?: string;
  domainFooter?: string;
  domainButtons?: Array<{
    type: 'URL' | 'QUICK_REPLY';
    text: string;
    url?: string;
  }>;
  meta: WhatsAppTemplateMetaSnapshot | null;
  metaRegistered: boolean;
  metaError?: string;
  appointmentMeta?: WhatsAppTemplateMetaState;
  dateFormat?: string;
  timeFormat?: string;
  metaLanguage?: string;
  title?: string;
  description?: string;
  metaCategory?: WhatsAppMetaCategory;
}

export interface SaveWhatsAppTemplatePayload {
  body: string;
  header?: string;
  footer?: string;
  buttons?: Array<{
    type: 'URL' | 'QUICK_REPLY';
    text: string;
    url?: string;
  }>;
  title?: string;
  description?: string;
  metaCategory?: WhatsAppMetaCategory;
  dateFormat?: string;
  timeFormat?: string;
  metaLanguage?: string;
}
