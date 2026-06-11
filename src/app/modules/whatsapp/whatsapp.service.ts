import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { v4 as uuidv4 } from 'uuid';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { normalizeColombiaWaPhone } from '../../shared/shared.functions';
import {
  WhatsAppConversation,
  WhatsAppConversationKey,
} from '../../schemas/whatsapp-conversation.schema';
import {
  WhatsAppMessage,
  WhatsAppMessageKey,
  WhatsAppMessageStatus,
} from '../../schemas/whatsapp-message.schema';
import { WhatsAppIntegrationData } from '../../schemas/integration.schema';
import { User } from '../../schemas/user.schema';
import {
  SendWhatsAppMessageDto,
  SendWhatsAppTemplateDto,
  ListMessagesQueryDto,
  WhatsAppMessagesPageDto,
  RegisterTemplatesBatchDto,
  TemplateRegistrationResultDto,
  RegisterTemplateItemDto,
} from './dto/whatsapp.dto';
import {
  convertVyvaBodyToMeta,
  sanitizeMetaTemplateName,
  validateMetaTemplateBody,
} from '../../shared/whatsapp-template.util';
import {
  WhatsAppTemplateSummary,
  WhatsAppTestPhoneNumber,
  WhatsAppTokenDiagnostics,
} from './whatsapp-meta.service';
import {
  getServiceWindowState,
  withServiceWindow,
} from '../../shared/whatsapp-window';
import { IntegrationsCredentialsService } from './integrations-credentials.service';
import { WhatsAppMetaService } from './whatsapp-meta.service';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    @InjectModel('WhatsAppMessage')
    private readonly messageModel: Model<WhatsAppMessage, WhatsAppMessageKey>,
    @InjectModel('WhatsAppConversation')
    private readonly conversationModel: Model<
      WhatsAppConversation,
      WhatsAppConversationKey
    >,
    private readonly credentialsService: IntegrationsCredentialsService,
    private readonly metaService: WhatsAppMetaService,
  ) {}

  async listConversations(
    idBusiness: string,
  ): Promise<GenericResponse<WhatsAppConversation[]>> {
    const rows = await this.conversationModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('idBusiness-lastMessageAt-index')
      .exec();

    const conversations = rows
      .map((r) => withServiceWindow(r.toJSON() as WhatsAppConversation))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    return new GenericResponse(conversations);
  }

  async listMessages(
    idBusiness: string,
    idConversation: string,
    query: ListMessagesQueryDto,
  ): Promise<GenericResponse<WhatsAppMessagesPageDto>> {
    const conversation = await this.conversationModel.get({
      id: idConversation,
    });
    if (!conversation) {
      throw new Error('MS007');
    }
    const conv = conversation.toJSON() as WhatsAppConversation;
    if (conv.idBusiness !== idBusiness) {
      throw new Error('MS007');
    }

    const limit = query.limit ?? 20;
    const rows = await this.messageModel
      .query('idConversation')
      .eq(idConversation)
      .using('idConversation-timestamp-index')
      .exec();
    const messages = rows
      .map((r) => r.toJSON() as WhatsAppMessage)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit)
      .reverse();

    const lastInboundAt = await this.resolveLastInboundAt(conv);
    const windowState = getServiceWindowState(lastInboundAt);

    return new GenericResponse({
      messages,
      lastInboundAt,
      ...windowState,
    });
  }

  async sendMessage(
    idBusiness: string,
    dto: SendWhatsAppMessageDto,
  ): Promise<GenericResponse<WhatsAppMessage>> {
    const existingByClient = await this.findByClientMessageId(
      dto.clientMessageId,
    );
    if (existingByClient && existingByClient.idBusiness === idBusiness) {
      return new GenericResponse(existingByClient);
    }

    const credentials =
      await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(credentials)) {
      throw new Error('MS042');
    }

    let conversation: WhatsAppConversation | null = null;
    if (dto.idConversation) {
      const row = await this.conversationModel.get({ id: dto.idConversation });
      if (row) {
        const c = row.toJSON() as WhatsAppConversation;
        if (c.idBusiness === idBusiness) {
          conversation = c;
        }
      }
    }

    const waPhone = normalizeColombiaWaPhone(
      dto.waPhone || conversation?.waPhone || '',
    );
    if (!waPhone) {
      throw new Error('MS043');
    }

    if (!conversation) {
      conversation = await this.findOrCreateConversation(idBusiness, waPhone);
    }

    const now = Date.now();
    const messageId = uuidv4();
    const pending: WhatsAppMessage = {
      id: messageId,
      idConversation: conversation.id,
      idBusiness,
      idCustomer: conversation.idCustomer,
      clientMessageId: dto.clientMessageId,
      direction: 'outbound',
      waPhone,
      type: 'text',
      body: dto.text,
      status: 'pending',
      timestamp: now,
    };

    await this.messageModel.create(pending);

    try {
      const { metaMessageId } = await this.metaService.sendTextMessage(
        credentials!,
        waPhone,
        dto.text,
      );

      await this.messageModel.update(
        { id: messageId },
        {
          metaMessageId,
          status: 'sent' as WhatsAppMessageStatus,
        },
      );

      await this.touchConversation(conversation.id, dto.text, now);

      const saved = await this.messageModel.get({ id: messageId });
      return new GenericResponse(saved?.toJSON() as WhatsAppMessage);
    } catch (err) {
      await this.messageModel.update(
        { id: messageId },
        { status: 'failed' as WhatsAppMessageStatus },
      );
      const saved = await this.messageModel.get({ id: messageId });
      return this.metaErrorResponse(
        err,
        (saved?.toJSON() as WhatsAppMessage) ?? pending,
      );
    }
  }

  async handleWebhookPayload(body: Record<string, unknown>): Promise<void> {
    const entries = (body.entry as unknown[]) || [];
    for (const entry of entries) {
      const changes = ((entry as any).changes as unknown[]) || [];
      for (const change of changes) {
        const value = (change as any).value;
        if (!value) {
          continue;
        }
        const phoneNumberId = value.metadata?.phone_number_id as string;
        if (!phoneNumberId) {
          continue;
        }

        const resolved =
          await this.credentialsService.resolveBusinessByPhoneNumberId(
            phoneNumberId,
          );
        if (!resolved) {
          this.logger.warn(
            `No WhatsApp integration for phone_number_id ${phoneNumberId}`,
          );
          continue;
        }

        const { idBusiness } = resolved;

        if (Array.isArray(value.messages)) {
          for (const msg of value.messages) {
            await this.persistInboundMessage(idBusiness, msg, value);
          }
        }

        if (Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            await this.patchMessageStatus(status);
          }
        }
      }
    }
  }

  async verifyWebhookToken(
    mode: string,
    token: string,
    challenge: string,
  ): Promise<string | null> {
    if (mode !== 'subscribe' || !token) {
      return null;
    }
    const valid =
      await this.credentialsService.isWebhookVerifyTokenValid(token);
    if (!valid) {
      return null;
    }
    return challenge || null;
  }

  private async persistInboundMessage(
    idBusiness: string,
    msg: Record<string, any>,
    value: Record<string, any>,
  ): Promise<void> {
    const metaMessageId = msg.id as string;
    if (!metaMessageId) {
      return;
    }

    const existing = await this.findByMetaMessageId(metaMessageId);
    if (existing) {
      return;
    }

    const waPhone = String(msg.from || '').replace(/\D/g, '');
    if (!waPhone) {
      return;
    }

    const conversation = await this.findOrCreateConversation(
      idBusiness,
      waPhone,
      msg.profile?.name,
    );

    const timestamp = Number(msg.timestamp) * 1000 || Date.now();
    const { type, body } = this.extractMessageContent(msg);

    const record: WhatsAppMessage = {
      id: uuidv4(),
      idConversation: conversation.id,
      idBusiness,
      idCustomer: conversation.idCustomer,
      metaMessageId,
      direction: 'inbound',
      waPhone,
      type,
      body,
      payload: JSON.stringify({ message: msg, value }),
      status: 'delivered',
      timestamp,
    };

    await this.messageModel.create(record);
    await this.touchConversation(
      conversation.id,
      body || `[${type}]`,
      timestamp,
      { inbound: true },
    );
  }

  private async patchMessageStatus(status: Record<string, any>): Promise<void> {
    const metaMessageId = status.id as string;
    const newStatus = status.status as WhatsAppMessageStatus;
    if (!metaMessageId || !newStatus) {
      return;
    }

    const existing = await this.findByMetaMessageId(metaMessageId);
    if (!existing) {
      return;
    }

    const mapped = this.mapMetaStatus(newStatus);
    if (mapped === existing.status) {
      return;
    }

    await this.messageModel.update({ id: existing.id }, { status: mapped });
  }

  private mapMetaStatus(status: string): WhatsAppMessageStatus {
    switch (status) {
      case 'sent':
        return 'sent';
      case 'delivered':
        return 'delivered';
      case 'read':
        return 'read';
      case 'failed':
        return 'failed';
      default:
        return 'sent';
    }
  }

  private extractMessageContent(msg: Record<string, any>): {
    type: string;
    body?: string;
  } {
    const type = (msg.type as string) || 'text';
    if (type === 'text' && msg.text?.body) {
      return { type, body: msg.text.body as string };
    }
    return { type, body: undefined };
  }

  private async findByMetaMessageId(
    metaMessageId: string,
  ): Promise<WhatsAppMessage | null> {
    const rows = await this.messageModel
      .query('metaMessageId')
      .eq(metaMessageId)
      .using('metaMessageId-index')
      .exec();
    if (!rows?.length) {
      return null;
    }
    return rows[0].toJSON() as WhatsAppMessage;
  }

  private async findByClientMessageId(
    clientMessageId: string,
  ): Promise<WhatsAppMessage | null> {
    const rows = await this.messageModel
      .query('clientMessageId')
      .eq(clientMessageId)
      .using('clientMessageId-index')
      .exec();
    if (!rows?.length) {
      return null;
    }
    return rows[0].toJSON() as WhatsAppMessage;
  }

  private async findOrCreateConversation(
    idBusiness: string,
    waPhone: string,
    displayName?: string,
  ): Promise<WhatsAppConversation> {
    const all = await this.conversationModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('idBusiness-lastMessageAt-index')
      .exec();

    const found = all.find(
      (c) => (c.toJSON() as WhatsAppConversation).waPhone === waPhone,
    );
    if (found) {
      const conv = found.toJSON() as WhatsAppConversation;
      if (displayName && !conv.displayName) {
        await this.conversationModel.update({ id: conv.id }, { displayName });
        conv.displayName = displayName;
      }
      return conv;
    }

    const now = Date.now();
    const conversation: WhatsAppConversation = {
      id: uuidv4(),
      idBusiness,
      waPhone,
      displayName: displayName || waPhone,
      lastMessageAt: now,
      lastMessagePreview: '',
    };
    await this.conversationModel.create(conversation);
    return conversation;
  }

  private async touchConversation(
    id: string,
    preview: string,
    lastMessageAt: number,
    options?: { inbound?: boolean },
  ): Promise<void> {
    const update: Partial<WhatsAppConversation> = {
      lastMessageAt,
      lastMessagePreview: preview.slice(0, 200),
    };
    if (options?.inbound) {
      update.lastInboundAt = lastMessageAt;
    }
    await this.conversationModel.update({ id }, update);
  }

  private async resolveLastInboundAt(
    conversation: WhatsAppConversation,
  ): Promise<number | undefined> {
    if (conversation.lastInboundAt) {
      return conversation.lastInboundAt;
    }

    const resolved = await this.findLastInboundTimestamp(conversation.id);
    if (resolved) {
      await this.conversationModel.update(
        { id: conversation.id },
        { lastInboundAt: resolved },
      );
    }
    return resolved;
  }

  private async findLastInboundTimestamp(
    idConversation: string,
  ): Promise<number | undefined> {
    const rows = await this.messageModel
      .query('idConversation')
      .eq(idConversation)
      .using('idConversation-timestamp-index')
      .exec();

    const inbounds = rows
      .map((r) => r.toJSON() as WhatsAppMessage)
      .filter((m) => m.direction === 'inbound');
    if (!inbounds.length) {
      return undefined;
    }

    return Math.max(...inbounds.map((m) => m.timestamp));
  }

  async registerTemplates(
    idBusiness: string,
    dto: RegisterTemplatesBatchDto,
  ): Promise<GenericResponse<TemplateRegistrationResultDto[]>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS042');
    }

    const wabaId = await this.metaService.getWabaIdForBusiness(creds!);
    const results: TemplateRegistrationResultDto[] = [];

    for (const item of dto.templates) {
      results.push(await this.registerSingleTemplate(creds!, wabaId, item));
    }

    return new GenericResponse(results);
  }

  private async registerSingleTemplate(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
    item: RegisterTemplateItemDto,
  ): Promise<TemplateRegistrationResultDto> {
    const name = sanitizeMetaTemplateName(item.name);
    const conversion = convertVyvaBodyToMeta(item.body);
    const validation = validateMetaTemplateBody(conversion.metaBody);

    if (!validation.valid) {
      return {
        key: item.key,
        name,
        success: false,
        error: validation.errors.join(' '),
      };
    }

    try {
      await this.metaService.deleteMessageTemplateByName(
        credentials,
        wabaId,
        name,
      );

      const created = await this.metaService.createMessageTemplate(
        credentials,
        wabaId,
        {
          name,
          language: item.language,
          category: item.category,
          bodyText: conversion.metaBody,
          bodyExamples: conversion.bodyExamples,
        },
      );

      return {
        key: item.key,
        name,
        success: true,
        status: created.status,
        metaTemplateId: created.id,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Error al registrar en Meta';
      return {
        key: item.key,
        name,
        success: false,
        error: message,
      };
    }
  }

  async listTemplates(
    idBusiness: string,
  ): Promise<GenericResponse<WhatsAppTemplateSummary[]>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS042');
    }

    try {
      const templates = await this.metaService.listMessageTemplates(creds!);
      return new GenericResponse(templates);
    } catch (err) {
      return this.metaErrorResponse(err, []);
    }
  }

  async listTestPhoneNumbers(
    idBusiness: string,
  ): Promise<GenericResponse<WhatsAppTestPhoneNumber[]>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS042');
    }

    try {
      const numbers = await this.metaService.listTestPhoneNumbers(creds!);
      return new GenericResponse(numbers);
    } catch (err) {
      return this.metaErrorResponse(err, []);
    }
  }

  async handleMetaOAuthCallback(
    idBusiness: string,
    userId: string,
    code: string,
    redirectUri?: string,
  ): Promise<GenericResponse<{ phoneNumberId: string; wabaId: string }>> {
    try {
      const result = await this.metaService.connectViaOAuthCode(
        code,
        redirectUri,
      );

      await this.credentialsService.upsertWhatsAppIntegration(idBusiness, userId, {
        phoneNumberId: result.phoneNumberId,
        accessToken: result.accessToken,
        appSecret: process.env.META_APP_SECRET?.trim() ?? '',
      });

      return new GenericResponse({
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
      });
    } catch (err) {
      return this.metaErrorResponse(err, {
        phoneNumberId: '',
        wabaId: '',
      });
    }
  }

  async diagnoseIntegration(
    idBusiness: string,
  ): Promise<GenericResponse<WhatsAppTokenDiagnostics>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS042');
    }

    const diagnostics = await this.metaService.diagnoseCredentials(creds!);
    return new GenericResponse(diagnostics);
  }

  async sendTemplate(
    idBusiness: string,
    dto: SendWhatsAppTemplateDto,
  ): Promise<GenericResponse<WhatsAppMessage>> {
    const existingByClient = await this.findByClientMessageId(
      dto.clientMessageId,
    );
    if (existingByClient && existingByClient.idBusiness === idBusiness) {
      return new GenericResponse(existingByClient);
    }

    const credentials =
      await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(credentials)) {
      throw new Error('MS042');
    }

    let conversation: WhatsAppConversation | null = null;
    if (dto.idConversation) {
      const row = await this.conversationModel.get({ id: dto.idConversation });
      if (row) {
        const c = row.toJSON() as WhatsAppConversation;
        if (c.idBusiness === idBusiness) {
          conversation = c;
        }
      }
    }

    const waPhone = normalizeColombiaWaPhone(
      dto.waPhone || conversation?.waPhone || '',
    );
    if (!waPhone) {
      throw new Error('MS043');
    }

    if (!conversation) {
      conversation = await this.findOrCreateConversation(idBusiness, waPhone);
    }

    const bodyParameters = dto.bodyParameters ?? [];
    const now = Date.now();
    const messageId = uuidv4();
    const bodyPreview =
      dto.bodyPreview?.trim() ||
      this.buildTemplatePreview(dto.templateName, bodyParameters);

    const pending: WhatsAppMessage = {
      id: messageId,
      idConversation: conversation.id,
      idBusiness,
      idCustomer: conversation.idCustomer,
      clientMessageId: dto.clientMessageId,
      direction: 'outbound',
      waPhone,
      type: 'template',
      body: bodyPreview,
      payload: JSON.stringify({
        templateName: dto.templateName,
        languageCode: dto.languageCode,
        bodyParameters,
      }),
      status: 'pending',
      timestamp: now,
    };

    await this.messageModel.create(pending);

    try {
      const { metaMessageId } = await this.metaService.sendTemplateMessage(
        credentials!,
        waPhone,
        dto.templateName,
        dto.languageCode,
        bodyParameters,
      );

      await this.messageModel.update(
        { id: messageId },
        {
          metaMessageId,
          status: 'sent' as WhatsAppMessageStatus,
        },
      );

      await this.touchConversation(conversation.id, bodyPreview, now);

      const saved = await this.messageModel.get({ id: messageId });
      return new GenericResponse(saved?.toJSON() as WhatsAppMessage);
    } catch (err) {
      await this.messageModel.update(
        { id: messageId },
        { status: 'failed' as WhatsAppMessageStatus },
      );
      return this.metaErrorResponse(err, null as unknown as WhatsAppMessage);
    }
  }

  async requestIntegrationCode(idBusiness: string): Promise<
    GenericResponse<{
      codeSent: boolean;
      alreadyVerified?: boolean;
    }>
  > {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS007');
    }

    try {
      const result = await this.metaService.requestVerificationCode(creds!);
      return new GenericResponse(result);
    } catch (err) {
      return this.metaErrorResponse(err, { codeSent: false });
    }
  }

  async verifyAndRegisterPhone(
    idBusiness: string,
    code: string,
  ): Promise<GenericResponse<{ registered: boolean }>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS007');
    }

    try {
      await this.metaService.verifyCode(creds!, code);
      await this.metaService.registerPhoneNumber(creds!, code);
      return new GenericResponse({ registered: true });
    } catch (err) {
      return this.metaErrorResponse(err, { registered: false });
    }
  }

  private buildTemplatePreview(
    templateName: string,
    bodyParameters: string[],
  ): string {
    if (!bodyParameters.length) {
      return `[Plantilla: ${templateName}]`;
    }

    return bodyParameters.join(' · ');
  }

  private metaErrorResponse<T>(err: unknown, data: T): GenericResponse<T> {
    const message = this.formatMetaErrorMessage(err);
    this.logger.warn(`Meta API error: ${message}`);
    return new GenericResponse(
      data,
      false,
      message,
      true,
      'WA_META',
      HttpStatus.BAD_REQUEST,
    );
  }

  private formatMetaErrorMessage(err: unknown): string {
    const raw =
      err instanceof Error ? err.message : 'Error al comunicarse con Meta';

    if (
      raw.includes('Error validating access token') ||
      raw.includes('session has been invalidated')
    ) {
      return (
        'El token de acceso de Meta no es válido o expiró. Genera un nuevo token permanente ' +
        'del System User en Meta Business Suite, actualízalo en la configuración y vuelve a intentar.'
      );
    }

    if (
      raw.includes('133010') ||
      raw.toLowerCase().includes('not registered')
    ) {
      return (
        'El número de teléfono no está registrado en Cloud API (Meta 133010). ' +
        'Completa la verificación en la configuración de WhatsApp en Vyva (PIN/SMS).'
      );
    }

    if (
      raw.includes('131030') ||
      raw.toLowerCase().includes('not in allowed list')
    ) {
      return (
        'Meta rechazó el destinatario (131030): el número no está en la lista permitida. ' +
        'En modo desarrollo, agrégalo como número de prueba en developers.facebook.com → WhatsApp → API Setup.'
      );
    }

    if (
      raw.includes('131047') ||
      raw.toLowerCase().includes('re-engagement') ||
      raw.toLowerCase().includes('24 hour')
    ) {
      return (
        'Meta exige una plantilla aprobada para reabrir la conversación (ventana de 24 h cerrada). ' +
        'Usa una plantilla desde el banner del chat.'
      );
    }

    if (
      raw.includes('(#100)') ||
      raw.toLowerCase().includes('invalid parameter')
    ) {
      return `${raw} Revisa que el Phone Number ID y el token sean de la misma app y número en Meta.`;
    }

    if (raw.includes('200') && raw.toLowerCase().includes('permission')) {
      return `${raw} El token no tiene permiso sobre ese Phone Number ID. Usa el mismo token y Phone Number ID que en API Setup.`;
    }

    return raw;
  }
}
