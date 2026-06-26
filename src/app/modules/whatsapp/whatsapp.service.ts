import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { randomInt } from 'crypto';
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
import { Domain, DomainKey } from '../../schemas/domain.schema';
import { User } from '../../schemas/user.schema';
import {
  SendWhatsAppMessageDto,
  SendWhatsAppTemplateDto,
  ListMessagesQueryDto,
  WhatsAppMessagesPageDto,
  RegisterTemplatesBatchDto,
  TemplateRegistrationResultDto,
  RegisterTemplateItemDto,
  SaveWhatsAppTemplateDto,
  IntegrationSetupResultDto,
  UpdateWhatsAppBusinessProfileDto,
} from './dto/whatsapp.dto';
import {
  convertVyvaBodyToMeta,
  countMetaTemplateVariables,
  formatTemplateBody,
  isValidMetaTemplateName,
  normalizeMetaTemplateLanguage,
  sanitizeMetaTemplateName,
  validateMetaTemplateBody,
  validateVyvaTemplateBody,
} from '../../shared/whatsapp-template.util';
import {
  DEFAULT_WHATSAPP_MESSAGE_CONFIG,
  APPOINTMENT_TEMPLATE_KEYS,
  normalizeWhatsAppMessageConfig,
  WHATSAPP_MESSAGES_DOMAIN_GROUP,
} from '../../shared/whatsapp-message-config.util';
import { WhatsAppMessageConfig, MetaTemplateSyncSource } from '../../shared/whatsapp-message-config.types';
import {
  applyRegistrationResultToConfig,
  applyTemplateSaveToConfig,
  buildWhatsAppTemplateCatalog,
  buildWhatsAppTemplateEditorDetail,
  findMetaTemplateByName,
  resolveMetaRegistrationName,
  resolveTemplateKind,
} from '../../shared/whatsapp-template-catalog.util';
import {
  WhatsAppTemplateCatalogItem,
  WhatsAppTemplateEditorDetail,
  WhatsAppTemplateSaveResult,
} from '../../shared/whatsapp-template-catalog.types';
import {
  WhatsAppTemplateSummary,
  WhatsAppTestPhoneNumber,
  WhatsAppTokenDiagnostics,
  WhatsAppBusinessProfile,
} from './whatsapp-meta.service';
import {
  getServiceWindowState,
  withServiceWindow,
} from '../../shared/whatsapp-window';
import { extractWhatsAppMessageContent } from '../../shared/whatsapp-message-content.util';
import { IntegrationsCredentialsService } from './integrations-credentials.service';
import { WhatsAppMetaService } from './whatsapp-meta.service';
import { RealtimePublisherService } from './realtime-publisher.service';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private static readonly WHATSAPP_TEST_USERS_GROUP = 'whatsappTestUsers';
  private static readonly WHATSAPP_MESSAGES_GROUP =
    WHATSAPP_MESSAGES_DOMAIN_GROUP;
  private static readonly TEMPLATE_BODY_CACHE_MS = 5 * 60 * 1000;
  private readonly templateBodyCache = new Map<
    string,
    { body: string; cachedAt: number }
  >();

  constructor(
    @InjectModel('WhatsAppMessage')
    private readonly messageModel: Model<WhatsAppMessage, WhatsAppMessageKey>,
    @InjectModel('WhatsAppConversation')
    private readonly conversationModel: Model<
      WhatsAppConversation,
      WhatsAppConversationKey
    >,
    @InjectModel('Domain')
    private readonly domainModel: Model<Domain, DomainKey>,
    private readonly credentialsService: IntegrationsCredentialsService,
    private readonly metaService: WhatsAppMetaService,
    private readonly realtimePublisher: RealtimePublisherService,
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

  async getUnreadCounts(
    idBusiness: string,
  ): Promise<
    GenericResponse<{ total: number; byConversationId: Record<string, number> }>
  > {
    const rows = await this.conversationModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('idBusiness-lastMessageAt-index')
      .exec();

    const conversations = rows.map(
      (r) => r.toJSON() as WhatsAppConversation,
    );
    const byConversationId: Record<string, number> = {};
    let total = 0;

    await Promise.all(
      conversations.map(async (conversation) => {
        const count = await this.resolveConversationUnreadCount(conversation);
        if (count > 0) {
          byConversationId[conversation.id] = count;
          total += count;
        }
      }),
    );

    return new GenericResponse({ total, byConversationId });
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
      conversation = await this.findOrCreateConversation(
        idBusiness,
        waPhone,
        dto.displayName,
      );
    }

    conversation = await this.applyConversationCustomerLink(
      conversation,
      dto.idCustomer,
      dto.displayName,
    );

    const now = Date.now();
    const messageId = uuidv4();
    const pending: WhatsAppMessage = {
      id: messageId,
      idConversation: conversation.id,
      idBusiness,
      idCustomer: conversation.idCustomer ?? dto.idCustomer,
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
          sentAt: Date.now(),
        },
      );

      await this.touchConversation(conversation.id, dto.text, now);

      const saved = await this.messageModel.get({ id: messageId });
      const savedMsg = saved?.toJSON() as WhatsAppMessage;
      await this.publishRealtimeMessage(idBusiness, savedMsg, conversation, now);
      return new GenericResponse(savedMsg);
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
            String(phoneNumberId),
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
            try {
              const saved = await this.persistInboundMessage(
                idBusiness,
                msg,
                value,
              );
              if (saved) {
                await this.realtimePublisher.publish(idBusiness, 'message', saved);
              }
            } catch (err) {
              this.logger.error(
                `Failed to persist inbound message ${msg?.id ?? 'unknown'}: ${(err as Error)?.message ?? err}`,
                (err as Error)?.stack,
              );
            }
          }
        }

        if (Array.isArray(value.statuses)) {
          for (const status of value.statuses) {
            try {
              const patched = await this.patchMessageStatus(status);
              if (patched) {
                await this.realtimePublisher.publish(
                  patched.idBusiness,
                  'status',
                  patched,
                );
              }
            } catch (err) {
              this.logger.error(
                `Failed to patch message status ${status?.id ?? 'unknown'}: ${(err as Error)?.message ?? err}`,
                (err as Error)?.stack,
              );
            }
          }
        }
      }
    }
  }

  /**
   * Meta webhook GET verification (handshake).
   *
   * With Embedded Signup there is a single app-level webhook callback shared by
   * every onboarded business, so the verify token is a fixed app secret defined
   * in the server environment (META_WEBHOOK_VERIFY_TOKEN) and configured once in
   * the Meta App Dashboard — it is no longer the test number's phone_number_id.
   */
  // eslint-disable-next-line @typescript-eslint/require-await
  async verifyWebhookToken(
    mode: string,
    token: string,
    challenge: string,
  ): Promise<string | null> {
    if (mode !== 'subscribe' || !token?.trim()) {
      return null;
    }

    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN?.trim();
    if (!expectedToken) {
      this.logger.error(
        'META_WEBHOOK_VERIFY_TOKEN is not configured; rejecting webhook verification',
      );
      return null;
    }

    if (token.trim() !== expectedToken) {
      this.logger.warn('Webhook verify token mismatch');
      return null;
    }

    return challenge || null;
  }

  private async persistInboundMessage(
    idBusiness: string,
    msg: Record<string, any>,
    value: Record<string, any>,
  ): Promise<{
    message: WhatsAppMessage;
    conversation: WhatsAppConversation;
  } | null> {
    const metaMessageId = msg.id as string;
    if (!metaMessageId) {
      return null;
    }

    const existing = await this.findByMetaMessageId(metaMessageId);
    if (existing) {
      return null;
    }

    const waPhone = normalizeColombiaWaPhone(String(msg.from || ''));
    if (!waPhone) {
      return null;
    }

    const displayName = this.resolveContactDisplayName(value, waPhone);
    const waUserId = this.resolveContactWaUserId(value, waPhone);

    const conversation = await this.findOrCreateConversation(
      idBusiness,
      waPhone,
      displayName,
      waUserId,
    );

    const timestamp = Number(msg.timestamp) * 1000 || Date.now();
    const content = extractWhatsAppMessageContent(msg);

    const record: WhatsAppMessage = {
      id: uuidv4(),
      idConversation: conversation.id,
      idBusiness,
      idCustomer: conversation.idCustomer,
      metaMessageId,
      replyToMetaMessageId: content.replyToMetaMessageId,
      direction: 'inbound',
      waPhone,
      type: content.type,
      body: content.body,
      payload: JSON.stringify({
        message: msg,
        value,
        media: content.media,
      }),
      status: 'delivered',
      deliveredAt: timestamp,
      timestamp,
    };

    await this.messageModel.create(record);
    await this.touchConversation(
      conversation.id,
      content.body || `[${content.type}]`,
      timestamp,
      { inbound: true },
    );

    const preview = (content.body || `[${content.type}]`).slice(0, 200);
    const unreadCount = (conversation.unreadCount ?? 0) + 1;
    const updatedConversation: WhatsAppConversation = {
      ...conversation,
      lastMessageAt: timestamp,
      lastMessagePreview: preview,
      lastInboundAt: timestamp,
      unreadCount,
      displayName: conversation.displayName || displayName,
    };

    return {
      message: record,
      conversation: withServiceWindow(updatedConversation),
    };
  }

  async markConversationAsRead(
    idBusiness: string,
    idConversation: string,
  ): Promise<GenericResponse<{ marked: number }>> {
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

    const credentials =
      await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(credentials)) {
      throw new Error('MS042');
    }

    const rows = await this.messageModel
      .query('idConversation')
      .eq(idConversation)
      .using('idConversation-timestamp-index')
      .exec();

    const unread = rows
      .map((r) => r.toJSON() as WhatsAppMessage)
      .filter(
        (msg) =>
          msg.direction === 'inbound' &&
          msg.metaMessageId &&
          !msg.readByBusinessAt,
      );

    let marked = 0;
    const now = Date.now();
    for (const msg of unread) {
      try {
        await this.metaService.markMessageAsRead(
          credentials!,
          msg.metaMessageId!,
        );
        await this.messageModel.update(
          { id: msg.id },
          { readByBusinessAt: now },
        );
        marked++;
      } catch (err) {
        this.logger.warn(
          `Could not mark message ${msg.id} as read: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    await this.conversationModel.update(
      { id: idConversation },
      { unreadCount: 0 },
    );

    return new GenericResponse({ marked });
  }

  private async patchMessageStatus(
    status: Record<string, any>,
  ): Promise<(Partial<WhatsAppMessage> & {
    id: string;
    idConversation: string;
    idBusiness: string;
  }) | null> {
    const metaMessageId = status.id as string;
    const newStatus = status.status as string;
    if (!metaMessageId || !newStatus) {
      return null;
    }

    const existing = await this.findByMetaMessageId(metaMessageId);
    if (!existing) {
      return null;
    }

    const mapped = this.mapMetaStatus(newStatus);
    const statusTimestamp = status.timestamp
      ? Number(status.timestamp) * 1000
      : Date.now();
    const update: Partial<WhatsAppMessage> = { status: mapped };

    if (mapped === 'sent') {
      update.sentAt = statusTimestamp;
    }
    if (mapped === 'delivered') {
      update.deliveredAt = statusTimestamp;
    }
    if (mapped === 'read') {
      update.readAt = statusTimestamp;
      if (!existing.deliveredAt) {
        update.deliveredAt = statusTimestamp;
      }
    }
    if (mapped === 'failed' && Array.isArray(status.errors)) {
      update.statusErrors = JSON.stringify(status.errors);
    }

    if (
      mapped === existing.status &&
      !update.statusErrors &&
      !(mapped === 'read' && !existing.readAt) &&
      !(mapped === 'delivered' && !existing.deliveredAt) &&
      !(mapped === 'sent' && !existing.sentAt)
    ) {
      return null;
    }

    await this.messageModel.update({ id: existing.id }, update);

    return {
      id: existing.id,
      idConversation: existing.idConversation,
      idBusiness: existing.idBusiness,
      metaMessageId: existing.metaMessageId,
      ...update,
    };
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
    waUserId?: string,
  ): Promise<WhatsAppConversation> {
    const normalizedPhone = normalizeColombiaWaPhone(waPhone);
    const all = await this.conversationModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('idBusiness-lastMessageAt-index')
      .exec();

    const found = all.find((c) => {
      const conv = c.toJSON() as WhatsAppConversation;
      return normalizeColombiaWaPhone(conv.waPhone) === normalizedPhone;
    });
    if (found) {
      const conv = found.toJSON() as WhatsAppConversation;
      const updates: Partial<WhatsAppConversation> = {};
      if (displayName && !conv.displayName) {
        updates.displayName = displayName;
      }
      if (waUserId && !conv.waUserId) {
        updates.waUserId = waUserId;
      }
      if (conv.waPhone !== normalizedPhone) {
        updates.waPhone = normalizedPhone;
      }
      if (Object.keys(updates).length) {
        await this.conversationModel.update({ id: conv.id }, updates);
        return { ...conv, ...updates };
      }
      return conv;
    }

    const now = Date.now();
    const conversation: WhatsAppConversation = {
      id: uuidv4(),
      idBusiness,
      waPhone: normalizedPhone,
      displayName: displayName || normalizedPhone,
      ...(waUserId ? { waUserId } : {}),
      lastMessageAt: now,
      lastMessagePreview: '',
    };
    await this.conversationModel.create(conversation);
    return conversation;
  }

  async linkConversationCustomer(
    idBusiness: string,
    idConversation: string,
    dto: { idCustomer: string; displayName?: string },
  ): Promise<GenericResponse<WhatsAppConversation>> {
    const row = await this.conversationModel.get({ id: idConversation });
    if (!row) {
      throw new Error('MS044');
    }
    const conversation = row.toJSON() as WhatsAppConversation;
    if (conversation.idBusiness !== idBusiness) {
      throw new Error('MS044');
    }

    const updated = await this.applyConversationCustomerLink(
      conversation,
      dto.idCustomer,
      dto.displayName,
      { forceCustomer: true },
    );
    return new GenericResponse(updated);
  }

  private async applyConversationCustomerLink(
    conversation: WhatsAppConversation,
    idCustomer?: string,
    displayName?: string,
    options?: { forceCustomer?: boolean },
  ): Promise<WhatsAppConversation> {
    const updates: Partial<WhatsAppConversation> = {};
    if (
      idCustomer &&
      (options?.forceCustomer || !conversation.idCustomer)
    ) {
      updates.idCustomer = idCustomer;
    }
    const trimmedName = displayName?.trim();
    if (
      trimmedName &&
      (!conversation.displayName ||
        conversation.displayName === conversation.waPhone)
    ) {
      updates.displayName = trimmedName;
    }
    if (!Object.keys(updates).length) {
      return conversation;
    }
    await this.conversationModel.update({ id: conversation.id }, updates);
    return { ...conversation, ...updates };
  }

  private resolveContactDisplayName(
    value: Record<string, any>,
    waPhone: string,
  ): string | undefined {
    const normalizedPhone = normalizeColombiaWaPhone(waPhone);
    const contacts = value.contacts as
      | Array<{ wa_id?: string; profile?: { name?: string } }>
      | undefined;

    const match = contacts?.find(
      (contact) =>
        normalizeColombiaWaPhone(String(contact.wa_id ?? '')) ===
        normalizedPhone,
    );

    return match?.profile?.name?.trim() || undefined;
  }

  private resolveContactWaUserId(
    value: Record<string, any>,
    waPhone: string,
  ): string | undefined {
    const normalizedPhone = normalizeColombiaWaPhone(waPhone);
    const contacts = value.contacts as
      | Array<{ wa_id?: string; user_id?: string }>
      | undefined;

    const match = contacts?.find(
      (contact) =>
        normalizeColombiaWaPhone(String(contact.wa_id ?? '')) ===
        normalizedPhone,
    );

    const userId = match?.user_id?.trim();
    return userId || undefined;
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
      const current = await this.conversationModel.get({ id });
      const currentUnread =
        (current?.toJSON() as WhatsAppConversation | undefined)?.unreadCount ??
        0;
      update.unreadCount = currentUnread + 1;
    }
    await this.conversationModel.update({ id }, update);
  }

  private async resolveConversationUnreadCount(
    conversation: WhatsAppConversation,
  ): Promise<number> {
    if (
      typeof conversation.unreadCount === 'number' &&
      conversation.unreadCount >= 0
    ) {
      return conversation.unreadCount;
    }

    const count = await this.countUnreadInboundMessages(conversation.id);
    await this.conversationModel.update(
      { id: conversation.id },
      { unreadCount: count },
    );
    return count;
  }

  private async countUnreadInboundMessages(
    idConversation: string,
  ): Promise<number> {
    const rows = await this.messageModel
      .query('idConversation')
      .eq(idConversation)
      .using('idConversation-timestamp-index')
      .exec();

    return rows
      .map((r) => r.toJSON() as WhatsAppMessage)
      .filter(
        (msg) =>
          msg.direction === 'inbound' &&
          msg.metaMessageId &&
          !msg.readByBusinessAt,
      ).length;
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
    const language = normalizeMetaTemplateLanguage(item.language);
    const conversion = convertVyvaBodyToMeta(item.body);
    const validation = validateVyvaTemplateBody(item.body);

    if (!isValidMetaTemplateName(item.name)) {
      return {
        key: item.key,
        name,
        success: false,
        error: 'Nombre de plantilla inválido para Meta.',
      };
    }

    if (item.category === 'AUTHENTICATION') {
      return {
        key: item.key,
        name,
        success: false,
        error:
          'La categoría AUTHENTICATION no está soportada para plantillas personalizadas.',
      };
    }

    if (!validation.valid) {
      return {
        key: item.key,
        name,
        success: false,
        error: validation.errors.join(' '),
      };
    }

    const variableCount = countMetaTemplateVariables(conversion.metaBody);
    if (variableCount > 0 && conversion.bodyExamples.length !== variableCount) {
      return {
        key: item.key,
        name,
        success: false,
        error:
          'Faltan ejemplos para las variables del mensaje requeridas por Meta.',
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
          language,
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
    approvedOnly = true,
  ): Promise<GenericResponse<WhatsAppTemplateSummary[]>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS042');
    }

    try {
      const templates = await this.metaService.listMessageTemplates(creds!, {
        approvedOnly,
      });
      return new GenericResponse(templates);
    } catch (err) {
      return this.metaErrorResponse(err, []);
    }
  }

  async getMessageConfig(
    idBusiness: string,
  ): Promise<
    GenericResponse<{ config: WhatsAppMessageConfig; domainId?: string }>
  > {
    const { config: loaded, domainId } =
      await this.loadMessageConfigDomain(idBusiness);
    const config = normalizeWhatsAppMessageConfig(loaded);
    return new GenericResponse({ config, domainId });
  }

  async listTemplateCatalog(
    idBusiness: string,
  ): Promise<GenericResponse<WhatsAppTemplateCatalogItem[]>> {
    const { config } = await this.loadMessageConfigDomain(idBusiness);
    const metaTemplates = await this.fetchMetaTemplatesForEnrichment(idBusiness);
    const items = buildWhatsAppTemplateCatalog(config, metaTemplates);
    return new GenericResponse(items);
  }

  async getTemplateEditorDetail(
    idBusiness: string,
    key: string,
  ): Promise<GenericResponse<WhatsAppTemplateEditorDetail>> {
    const { config } = await this.loadMessageConfigDomain(idBusiness);
    const metaTemplates = await this.fetchMetaTemplatesForEnrichment(idBusiness);
    const detail = buildWhatsAppTemplateEditorDetail(config, key, metaTemplates);
    if (!detail) {
      throw new Error('MS007');
    }
    return new GenericResponse(detail);
  }

  async saveTemplate(
    idBusiness: string,
    key: string,
    dto: SaveWhatsAppTemplateDto,
  ): Promise<GenericResponse<WhatsAppTemplateSaveResult>> {
    const { config: loaded, domainId } =
      await this.loadMessageConfigDomain(idBusiness);
    let config = applyTemplateSaveToConfig(loaded, key, dto);
    const { kind } = resolveTemplateKind(config, key);
    const metaCategory =
      dto.metaCategory ??
      (kind === 'appointment'
        ? 'UTILITY'
        : config.customTemplates?.find((template) => template.key === key)
            ?.metaCategory ?? 'UTILITY');
    const language = normalizeMetaTemplateLanguage(
      dto.metaLanguage?.trim() || config.metaLanguage?.trim() || 'es',
    );

    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    const integrationConfigured = this.credentialsService.isConfigured(creds);

    if (integrationConfigured) {
      const vyvaValidation = validateVyvaTemplateBody(dto.body.trim());
      if (!vyvaValidation.valid) {
        this.logger.warn(
          `Template validation failed for ${key}: ${vyvaValidation.errors.join(' ')}`,
        );
        return this.handledErrorResponse<WhatsAppTemplateSaveResult>('MS014');
      }

      const wabaId = await this.metaService.getWabaIdForBusiness(creds!);
      const metaName = resolveMetaRegistrationName(config, key);
      if (!isValidMetaTemplateName(metaName)) {
        this.logger.warn(`Invalid Meta template name for ${key}: ${metaName}`);
        return this.handledErrorResponse<WhatsAppTemplateSaveResult>('MS014');
      }

      const result = await this.registerSingleTemplate(creds!, wabaId, {
        key,
        name: metaName,
        language,
        category: metaCategory,
        body: dto.body.trim(),
      });

      if (!result.success) {
        this.logger.warn(
          `Meta template registration failed for ${key}: ${result.error ?? 'unknown error'}`,
        );
        return this.handledErrorResponse<WhatsAppTemplateSaveResult>('MS014');
      }

      config = applyRegistrationResultToConfig(
        config,
        key,
        result,
        metaCategory,
        language,
      );
    }

    await this.saveMessageConfigDomain(idBusiness, config, domainId);

    const metaTemplates = await this.fetchMetaTemplatesForEnrichment(idBusiness);
    const detail = buildWhatsAppTemplateEditorDetail(config, key, metaTemplates);
    if (!detail) {
      throw new Error('MS007');
    }

    return new GenericResponse({
      key: detail.key,
      kind: detail.kind,
      displayBody: detail.displayBody,
      domainBody: detail.domainBody,
      meta: detail.meta,
      metaRegistered: integrationConfigured,
      appointmentMeta: detail.appointmentMeta,
    });
  }

  private async fetchMetaTemplatesForEnrichment(
    idBusiness: string,
  ): Promise<MetaTemplateSyncSource[] | null> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      return null;
    }

    try {
      return await this.metaService.listMessageTemplates(creds!, {
        approvedOnly: false,
      });
    } catch (err) {
      this.logger.warn(
        `WhatsApp template Meta enrichment skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  async saveMessageConfig(
    idBusiness: string,
    config: WhatsAppMessageConfig,
  ): Promise<
    GenericResponse<{ config: WhatsAppMessageConfig; domainId: string }>
  > {
    const normalized = normalizeWhatsAppMessageConfig(config);
    const { domainId } = await this.loadMessageConfigDomain(idBusiness);
    const savedDomainId = await this.saveMessageConfigDomain(
      idBusiness,
      normalized,
      domainId,
    );
    return new GenericResponse({
      config: normalized,
      domainId: savedDomainId,
    });
  }

  private async loadMessageConfigDomain(idBusiness: string): Promise<{
    config: WhatsAppMessageConfig;
    domainId?: string;
  }> {
    const domains = await this.domainModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('domain-idBusiness-index')
      .where('group')
      .eq(WhatsAppService.WHATSAPP_MESSAGES_GROUP)
      .exec();

    if (!domains?.length) {
      return { config: DEFAULT_WHATSAPP_MESSAGE_CONFIG };
    }

    const record = domains[0].toJSON() as Domain;
    try {
      const parsed = JSON.parse(record.value ?? '') as Partial<WhatsAppMessageConfig>;
      return {
        config: normalizeWhatsAppMessageConfig(parsed),
        domainId: record.id,
      };
    } catch {
      return {
        config: DEFAULT_WHATSAPP_MESSAGE_CONFIG,
        domainId: record.id,
      };
    }
  }

  private async saveMessageConfigDomain(
    idBusiness: string,
    config: WhatsAppMessageConfig,
    existingDomainId?: string,
  ): Promise<string> {
    const value = JSON.stringify(config);

    if (existingDomainId) {
      await this.domainModel.update({ id: existingDomainId }, { value });
      return existingDomainId;
    }

    const domains = await this.domainModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('domain-idBusiness-index')
      .where('group')
      .eq(WhatsAppService.WHATSAPP_MESSAGES_GROUP)
      .exec();

    if (domains?.length) {
      const record = domains[0].toJSON() as Domain;
      await this.domainModel.update({ id: record.id }, { value });
      return record.id;
    }

    const id = uuidv4();
    await this.domainModel.create({
      id,
      idBusiness,
      name: WhatsAppService.WHATSAPP_MESSAGES_GROUP,
      group: WhatsAppService.WHATSAPP_MESSAGES_GROUP,
      value,
      description: 'Mensajes predeterminados de WhatsApp por estado de cita',
      isActive: true,
      order: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  async listTestPhoneNumbers(
    idBusiness: string,
  ): Promise<
    GenericResponse<{
      phoneNumbers: WhatsAppTestPhoneNumber[];
      isSandbox: boolean;
    }>
  > {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      return new GenericResponse({ phoneNumbers: [], isSandbox: false });
    }

    try {
      const result = await this.metaService.listTestPhoneNumbers(creds!);
      return new GenericResponse(result);
    } catch (err) {
      return this.metaErrorResponse(err, { phoneNumbers: [], isSandbox: false });
    }
  }

  async getTestUsers(idBusiness: string): Promise<GenericResponse<string[]>> {
    try {
      const phones = await this.loadTestUsersFromDomain(idBusiness);
      return new GenericResponse(phones);
    } catch (err) {
      this.logger.error(
        `getTestUsers failed for business ${idBusiness}`,
        err instanceof Error ? err.stack : String(err),
      );
      return new GenericResponse(
        [],
        false,
        'No se pudieron cargar los números de prueba.',
        true,
        'WA_TEST_USERS',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async confirmMetaPaymentMethod(
    idBusiness: string,
  ): Promise<GenericResponse<{ metaPaymentMethodConfirmed: boolean }>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS042');
    }

    await this.credentialsService.markMetaPaymentMethodConfirmed(idBusiness);
    return new GenericResponse({ metaPaymentMethodConfirmed: true });
  }

  async addTestUser(
    idBusiness: string,
    phoneNumber: string,
  ): Promise<GenericResponse<string[]>> {
    const normalized = normalizeColombiaWaPhone(phoneNumber);
    if (!normalized) {
      throw new Error('MS043');
    }

    try {
      const phones = await this.loadTestUsersFromDomain(idBusiness);
      const next = [
        normalized,
        ...phones.filter((phone) => phone !== normalized),
      ];
      await this.saveTestUsersDomain(idBusiness, next);
      return new GenericResponse(next);
    } catch (err) {
      this.logger.error(
        `addTestUser failed for business ${idBusiness}`,
        err instanceof Error ? err.stack : String(err),
      );
      return new GenericResponse(
        [],
        false,
        'No se pudo guardar el número de prueba.',
        true,
        'WA_TEST_USERS',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  private async loadTestUsersFromDomain(idBusiness: string): Promise<string[]> {
    const domains = await this.domainModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('domain-idBusiness-index')
      .where('group')
      .eq(WhatsAppService.WHATSAPP_TEST_USERS_GROUP)
      .exec();

    if (!domains?.length) {
      return [];
    }

    const record = domains[0].toJSON() as Domain;
    try {
      const parsed = JSON.parse(record.value ?? '[]') as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter(Boolean);
    } catch {
      return [];
    }
  }

  private async saveTestUsersDomain(
    idBusiness: string,
    phones: string[],
  ): Promise<void> {
    const value = JSON.stringify(phones);
    const domains = await this.domainModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('domain-idBusiness-index')
      .where('group')
      .eq(WhatsAppService.WHATSAPP_TEST_USERS_GROUP)
      .exec();

    if (domains?.length) {
      const record = domains[0].toJSON() as Domain;
      await this.domainModel.update({ id: record.id }, { value });
      return;
    }

    await this.domainModel.create({
      id: uuidv4(),
      idBusiness,
      name: WhatsAppService.WHATSAPP_TEST_USERS_GROUP,
      group: WhatsAppService.WHATSAPP_TEST_USERS_GROUP,
      value,
      description: 'Números usados en pruebas de WhatsApp',
      isActive: true,
      order: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async handleMetaOAuthCallback(
    idBusiness: string,
    userId: string,
    code: string,
    _redirectUri?: string,
  ): Promise<
    GenericResponse<{
      phoneNumberId: string;
      wabaId: string;
      registered: boolean;
      registrationError?: string;
      setupComplete: boolean;
      templatesRegistered: boolean;
      setupError?: string;
    }>
  > {
    try {
      this.logger.log(
        'Meta OAuth callback: exchanging Embedded Signup code (no redirect_uri)',
      );
      const result = await this.metaService.connectViaOAuthCode(code);

      await this.credentialsService.upsertWhatsAppIntegration(idBusiness, userId, {
        phoneNumberId: result.phoneNumberId,
        accessToken: result.accessToken,
        appSecret: process.env.META_APP_SECRET?.trim() ?? '',
        useCredentials: false,
        phoneRegistered: false,
        metaEmbeddedSignup: result.embeddedSignup,
      });

      const setup = await this.runIntegrationSetup(idBusiness);

      return new GenericResponse({
        phoneNumberId: result.phoneNumberId,
        wabaId: result.wabaId,
        registered: setup.phoneRegistered,
        registrationError: setup.phoneRegistrationError,
        setupComplete: setup.setupComplete,
        templatesRegistered: setup.templatesRegistered,
        setupError:
          setup.templatesRegistrationError ??
          setup.phoneRegistrationError ??
          setup.setupError,
      });
    } catch (err) {
      return this.metaErrorResponse(err, {
        phoneNumberId: '',
        wabaId: '',
        registered: false,
        setupComplete: false,
        templatesRegistered: false,
      });
    }
  }

  async completeIntegrationSetup(
    idBusiness: string,
    useSystemUserToken?: boolean,
  ): Promise<GenericResponse<IntegrationSetupResultDto>> {
    const setup = await this.runIntegrationSetup(idBusiness, useSystemUserToken);

    if (!setup.setupComplete && setup.phoneRegistrationError) {
      return new GenericResponse(
        setup,
        false,
        setup.phoneRegistrationError,
        true,
        'WA_META',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!setup.setupComplete && setup.templatesRegistrationError) {
      return new GenericResponse(
        setup,
        false,
        setup.templatesRegistrationError,
        true,
        'WA_META',
        HttpStatus.BAD_REQUEST,
      );
    }

    return new GenericResponse(setup);
  }

  private async runIntegrationSetup(
    idBusiness: string,
    useSystemUserToken?: boolean,
  ): Promise<IntegrationSetupResultDto> {
    let creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      return {
        phoneRegistered: false,
        templatesRegistered: false,
        setupComplete: false,
        setupError: 'Integración no configurada',
      };
    }

    let phoneRegistered = creds!.phoneRegistered === true;
    let phoneRegistrationError: string | undefined;

    if (!phoneRegistered) {
      const registration = await this.registerPhoneWithManagedPin(
        idBusiness,
        creds!,
        useSystemUserToken,
      );
      phoneRegistered = registration.registered;
      phoneRegistrationError = registration.registrationError;
    }

    if (!phoneRegistered) {
      return {
        phoneRegistered: false,
        templatesRegistered: false,
        setupComplete: false,
        phoneRegistrationError,
      };
    }

    // Ensure the WABA is subscribed to our app webhooks (idempotent). Embedded
    // Signup usually subscribes during OAuth, but retry here in case it failed.
    await this.ensureWabaSubscribed(creds!);

    const templates = await this.registerDefaultAppointmentTemplates(idBusiness);

    return {
      phoneRegistered: true,
      templatesRegistered: templates.templatesRegistered,
      setupComplete: templates.templatesRegistered,
      phoneRegistrationError,
      templatesRegistrationError: templates.error,
      templateResults: templates.results,
    };
  }

  private async registerDefaultAppointmentTemplates(
    idBusiness: string,
  ): Promise<{
    templatesRegistered: boolean;
    results: TemplateRegistrationResultDto[];
    error?: string;
  }> {
    const { config: loaded } = await this.loadMessageConfigDomain(idBusiness);
    const config = normalizeWhatsAppMessageConfig(loaded);
    const metaTemplates =
      (await this.fetchMetaTemplatesForEnrichment(idBusiness)) ?? [];
    const catalog = buildWhatsAppTemplateCatalog(config, metaTemplates);

    const keysToRegister = APPOINTMENT_TEMPLATE_KEYS.filter((key) => {
      const item = catalog.find((entry) => entry.key === key);
      const status = item?.meta?.status;
      return !(
        item?.meta?.exists &&
        (status === 'APPROVED' || status === 'PENDING')
      );
    });

    if (keysToRegister.length === 0) {
      return { templatesRegistered: true, results: [] };
    }

    const results: TemplateRegistrationResultDto[] = [];

    for (const key of keysToRegister) {
      const detail = buildWhatsAppTemplateEditorDetail(
        config,
        key,
        metaTemplates,
      );
      if (!detail) {
        results.push({
          key,
          name: '',
          success: false,
          error: 'No se pudo cargar la plantilla predeterminada.',
        });
        continue;
      }

      try {
        const saveRes = await this.saveTemplate(idBusiness, key, {
          body: detail.domainBody,
          metaCategory: detail.metaCategory ?? 'UTILITY',
          dateFormat: detail.dateFormat,
          timeFormat: detail.timeFormat,
          metaLanguage: detail.metaLanguage ?? config.metaLanguage,
        });

        if (!saveRes.success || !saveRes.data) {
          results.push({
            key,
            name: resolveMetaRegistrationName(config, key),
            success: false,
            error: saveRes.message ?? 'No se pudo registrar la plantilla en Meta.',
          });
          continue;
        }

        const payload = saveRes.data;
        results.push({
          key,
          name: resolveMetaRegistrationName(config, key),
          success: payload.metaRegistered === true,
          status: payload.meta?.status,
        });
      } catch (err) {
        results.push({
          key,
          name: resolveMetaRegistrationName(config, key),
          success: false,
          error:
            err instanceof Error && err.message === 'MS014'
              ? 'MS014'
              : err instanceof Error
                ? err.message
                : 'No se pudo registrar la plantilla en Meta.',
        });
      }
    }

    const failed = results.filter((result) => !result.success);
    return {
      templatesRegistered: failed.length === 0,
      results,
      error:
        failed.length > 0
          ? `${failed.length} plantilla(s) no se pudieron registrar.`
          : undefined,
    };
  }

  /**
   * Best-effort subscription of our Meta app to the business WABA webhooks so
   * inbound messages reach the shared Embedded Signup webhook. Non-fatal: logs a
   * warning if it fails so phone/template setup can still complete.
   */
  private async ensureWabaSubscribed(
    creds: WhatsAppIntegrationData,
  ): Promise<void> {
    try {
      const wabaId = await this.metaService.getWabaIdForBusiness(creds);
      await this.metaService.subscribeAppToWaba(creds, wabaId);
    } catch (err) {
      this.logger.warn(
        `Could not ensure WABA webhook subscription: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /** Random 6-digit two-step verification PIN for Cloud API registration. */
  private generateTwoStepPin(): string {
    return String(randomInt(0, 1_000_000)).padStart(6, '0');
  }

  /**
   * Registers the business phone number on Cloud API using a server-managed
   * two-step verification PIN (reusing the stored one when available). No SMS
   * code is involved: Embedded Signup already verified the number.
   */
  private async registerPhoneWithManagedPin(
    idBusiness: string,
    creds: WhatsAppIntegrationData,
    useSystemUserToken?: boolean,
  ): Promise<{ registered: boolean; registrationError?: string }> {
    const pin = creds.twoStepPin?.trim() || this.generateTwoStepPin();

    try {
      await this.metaService.registerPhoneNumber(
        creds,
        pin,
        this.resolveUseSystemUserToken(creds, useSystemUserToken),
      );
      await this.credentialsService.markPhoneRegistered(idBusiness, pin);
      return { registered: true };
    } catch (err) {
      const registrationError =
        err instanceof Error
          ? err.message
          : 'No se pudo registrar el número en Cloud API';
      this.logger.warn(
        `Cloud API registration failed for business ${idBusiness}: ${registrationError}`,
      );
      return { registered: false, registrationError };
    }
  }

  async diagnoseIntegration(
    idBusiness: string,
  ): Promise<GenericResponse<WhatsAppTokenDiagnostics>> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      return new GenericResponse(this.buildUnconfiguredDiagnostics());
    }

    const diagnostics = await this.metaService.diagnoseCredentials(creds!);
    return new GenericResponse(diagnostics);
  }

  async getBusinessProfile(
    idBusiness: string,
  ): Promise<GenericResponse<WhatsAppBusinessProfile>> {
    const creds = await this.requireConfiguredCredentials(idBusiness);
    const profile = await this.metaService.getFullBusinessProfile(creds);
    return new GenericResponse(profile);
  }

  async updateBusinessProfile(
    idBusiness: string,
    dto: UpdateWhatsAppBusinessProfileDto,
  ): Promise<GenericResponse<WhatsAppBusinessProfile>> {
    const creds = await this.requireConfiguredCredentials(idBusiness);

    let profilePictureHandle: string | undefined;
    if (dto.profilePictureBase64?.trim()) {
      const parsed = this.parseProfilePictureBase64(dto.profilePictureBase64);
      profilePictureHandle = await this.metaService.uploadProfilePictureHandle(
        creds,
        parsed.buffer,
        parsed.mimeType,
        parsed.fileName,
      );
    }

    const displayNameInfo = await this.metaService.getPhoneNumberDisplayName(creds);
    const requestedDisplayName = dto.newDisplayName?.trim();
    if (
      requestedDisplayName &&
      displayNameInfo.displayNameEditable &&
      requestedDisplayName !== (displayNameInfo.verifiedName ?? '')
    ) {
      await this.metaService.updatePhoneNumberDisplayName(
        creds,
        requestedDisplayName,
      );
    }

    await this.metaService.updateBusinessProfile(creds, {
      about: dto.about,
      address: dto.address,
      description: dto.description,
      email: dto.email,
      websites: dto.websites,
      vertical: dto.vertical,
      profilePictureHandle,
    });

    const profile = await this.metaService.getFullBusinessProfile(creds);
    return new GenericResponse(profile);
  }

  private parseProfilePictureBase64(dataUrl: string): {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
  } {
    const match = dataUrl.trim().match(/^data:(image\/(?:jpeg|jpg|png));base64,(.+)$/i);
    if (!match) {
      throw new Error(
        'La imagen de perfil debe ser JPEG o PNG en formato base64.',
      );
    }

    const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
    const buffer = Buffer.from(match[2], 'base64');
    const maxBytes = 5 * 1024 * 1024;
    if (buffer.length > maxBytes) {
      throw new Error('La imagen de perfil no puede superar 5 MB.');
    }

    const ext = mimeType === 'image/png' ? 'png' : 'jpg';
    return {
      buffer,
      mimeType,
      fileName: `whatsapp-profile.${ext}`,
    };
  }

  private async requireConfiguredCredentials(
    idBusiness: string,
  ): Promise<WhatsAppIntegrationData> {
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    if (!this.credentialsService.isConfigured(creds)) {
      throw new Error('MS042');
    }
    return creds!;
  }

  private buildUnconfiguredDiagnostics(): WhatsAppTokenDiagnostics {
    return {
      phoneNumberIdConfigured: '',
      tokenValid: false,
      scopes: [],
      granularScopes: [],
      wabaIdsFromManagement: [],
      phoneNumberIdReachable: false,
      phoneNumberBelongsToWaba: null,
      issues: ['WhatsApp no está configurado para este negocio.'],
      hints: [
        'Conecta la cuenta de Meta en el onboarding de WhatsApp o ingresa las credenciales manualmente.',
      ],
    };
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
      conversation = await this.findOrCreateConversation(
        idBusiness,
        waPhone,
        dto.displayName,
      );
    }

    conversation = await this.applyConversationCustomerLink(
      conversation,
      dto.idCustomer,
      dto.displayName,
    );

    const bodyParameters = dto.bodyParameters ?? [];
    const now = Date.now();
    const messageId = uuidv4();
    const bodyPreview = await this.resolveRenderedTemplateBody(
      idBusiness,
      credentials!,
      dto.templateName,
      dto.languageCode,
      bodyParameters,
      dto.templateBody?.trim(),
      dto.bodyPreview?.trim(),
    );

    const pending: WhatsAppMessage = {
      id: messageId,
      idConversation: conversation.id,
      idBusiness,
      idCustomer: conversation.idCustomer ?? dto.idCustomer,
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
          sentAt: Date.now(),
        },
      );

      await this.touchConversation(conversation.id, bodyPreview, now);

      const saved = await this.messageModel.get({ id: messageId });
      const savedMsg = saved?.toJSON() as WhatsAppMessage;
      await this.publishRealtimeMessage(
        idBusiness,
        savedMsg,
        conversation,
        now,
        bodyPreview,
      );
      return new GenericResponse(savedMsg);
    } catch (err) {
      await this.messageModel.update(
        { id: messageId },
        { status: 'failed' as WhatsAppMessageStatus },
      );
      return this.metaErrorResponse(err, null as unknown as WhatsAppMessage);
    }
  }

  private async publishRealtimeMessage(
    idBusiness: string,
    message: WhatsAppMessage,
    conversation: WhatsAppConversation,
    lastMessageAt: number,
    preview?: string,
  ): Promise<void> {
    const lastMessagePreview = (
      preview ??
      message.body ??
      `[${message.type}]`
    ).slice(0, 200);
    await this.realtimePublisher.publish(idBusiness, 'message', {
      message,
      conversation: withServiceWindow({
        ...conversation,
        lastMessageAt,
        lastMessagePreview,
      }),
    });
  }

  private resolveUseSystemUserToken(
    creds: WhatsAppIntegrationData,
    override?: boolean,
  ): boolean {
    if (override !== undefined) {
      return override === true;
    }
    return creds.useSystemUserTokenForPhoneVerification === true;
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

  private async resolveRenderedTemplateBody(
    idBusiness: string,
    credentials: WhatsAppIntegrationData,
    templateName: string,
    languageCode: string,
    bodyParameters: string[],
    templateBodyHint?: string,
    bodyPreviewHint?: string,
  ): Promise<string> {
    const templateBody =
      templateBodyHint ||
      (await this.resolveTemplateBodyText(
        idBusiness,
        credentials,
        templateName,
        languageCode,
      ));

    if (templateBody) {
      const rendered = formatTemplateBody(templateBody, bodyParameters).trim();
      if (rendered) {
        return rendered;
      }
    }

    return (
      bodyPreviewHint ||
      this.buildTemplatePreview(templateName, bodyParameters)
    );
  }

  private async resolveTemplateBodyText(
    idBusiness: string,
    credentials: WhatsAppIntegrationData,
    templateName: string,
    languageCode: string,
  ): Promise<string | null> {
    const cacheKey = `${idBusiness}:${templateName}:${languageCode}`;
    const cached = this.templateBodyCache.get(cacheKey);
    if (
      cached &&
      Date.now() - cached.cachedAt < WhatsAppService.TEMPLATE_BODY_CACHE_MS
    ) {
      return cached.body;
    }

    try {
      const templates = await this.metaService.listMessageTemplates(
        credentials,
        { approvedOnly: false },
      );
      const match = findMetaTemplateByName(
        templates,
        templateName,
        languageCode,
      );
      const body = match?.preview?.trim();
      if (body) {
        this.templateBodyCache.set(cacheKey, {
          body,
          cachedAt: Date.now(),
        });
        return body;
      }
    } catch (err) {
      this.logger.warn(
        `Template body lookup failed for ${templateName}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return null;
  }

  private handledErrorResponse<T>(
    code: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ): GenericResponse<T> {
    return new GenericResponse(undefined as T, false, code, true, code, status);
  }

  private metaErrorResponse<T>(
    err: unknown,
    data: T,
    useRawMessage = false,
  ): GenericResponse<T> {
    const message = useRawMessage
      ? err instanceof Error
        ? err.message
        : String(err)
      : this.formatMetaErrorMessage(err);
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
      if (/app access token|owner or developer/i.test(raw)) {
        return `${raw} Verifica que META_APP_ID y META_APP_SECRET en el servidor coincidan con la app de Meta usada en Embedded Signup.`;
      }
      return `${raw} Revisa que el Phone Number ID y el token sean de la misma app y número en Meta.`;
    }

    if (raw.includes('200') && raw.toLowerCase().includes('permission')) {
      return `${raw} El token no tiene permiso sobre ese Phone Number ID. Usa el mismo token y Phone Number ID que en API Setup.`;
    }

    return raw;
  }
}
