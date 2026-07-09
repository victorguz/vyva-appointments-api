import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsAppIntegrationData } from '../../schemas/integration.schema';
import {
  isPlaceholderPhoneNumberId,
  isPlaceholderSecret,
} from '../../shared/whatsapp-integration.util';
import {
  MetaEmbeddedSignupSnapshot,
  redactMetaAccessTokenPayload,
} from '../../shared/meta-embedded-signup.types';
import { buildMetaTemplateComponents } from '../../shared/meta-template-components.util';
import { IntegrationsCredentialsService } from './integrations-credentials.service';

/** Meta Graph API version used for outbound messages (Cloud API). */
export const WHATSAPP_GRAPH_API_VERSION = 'v25.0';

export interface MetaSendTextResult {
  metaMessageId: string;
}

interface MetaGraphError {
  message: string;
  code?: number;
}

interface MetaDebugTokenData {
  app_id?: string;
  type?: string;
  is_valid?: boolean;
  expires_at?: number;
  scopes?: string[];
  granular_scopes?: { scope?: string; target_ids?: string[] }[];
  error?: MetaGraphError;
}

export interface WhatsAppTokenDiagnostics {
  phoneNumberIdConfigured: string;
  tokenValid: boolean;
  tokenType?: string;
  appId?: string;
  tokenExpiresAt?: number;
  scopes: string[];
  granularScopes: { scope: string; targetIds: string[] }[];
  wabaIdsFromManagement: string[];
  phoneNumberIdReachable: boolean;
  phoneNumberDisplay?: string;
  phoneNumberBelongsToWaba: boolean | null;
  resolvedWabaId?: string;
  metaBusinessId?: string;
  issues: string[];
  hints: string[];
}

interface MetaGraphResponse {
  success?: boolean;
  error?: MetaGraphError;
}

export interface WhatsAppTemplateSummary {
  name: string;
  language: string;
  category?: string;
  status?: string;
  preview: string;
  bodyParameterCount: number;
}

export interface WhatsAppTestPhoneNumber {
  /** E.164 phone number string from Meta */
  phoneNumber: string;
}

export const WHATSAPP_BUSINESS_VERTICALS = [
  'OTHER',
  'AUTO',
  'BEAUTY',
  'APPAREL',
  'EDU',
  'ENTERTAIN',
  'EVENT_PLAN',
  'FINANCE',
  'GROCERY',
  'GOVT',
  'HOTEL',
  'HEALTH',
  'NONPROFIT',
  'PROF_SERVICES',
  'RETAIL',
  'TRAVEL',
  'RESTAURANT',
] as const;

export type WhatsAppBusinessVertical =
  (typeof WHATSAPP_BUSINESS_VERTICALS)[number];

export interface WhatsAppBusinessProfile {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  profilePictureUrl?: string;
  websites?: string[];
  vertical?: WhatsAppBusinessVertical | string;
  verifiedName?: string;
  newDisplayName?: string;
  nameStatus?: string;
  newNameStatus?: string;
  displayNameEditable?: boolean;
  /** Business @username from Meta Username API. */
  username?: string;
  usernameStatus?: string;
}

export interface WhatsAppMessageRecipient {
  phone?: string;
  userId?: string;
}

export interface UpdateWhatsAppBusinessProfileInput {
  about?: string;
  address?: string;
  description?: string;
  email?: string;
  websites?: string[];
  vertical?: WhatsAppBusinessVertical | string;
  profilePictureHandle?: string;
  newDisplayName?: string;
}

export interface MetaOAuthConnectResult {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
  embeddedSignup: MetaEmbeddedSignupSnapshot;
}

interface MetaTemplateComponent {
  type?: string;
  format?: string;
  text?: string;
  buttons?: Array<{ type?: string; text?: string }>;
}

interface MetaMessageTemplate {
  name: string;
  status: string;
  language: string;
  category?: string;
  components?: MetaTemplateComponent[];
}

@Injectable()
export class WhatsAppMetaService {
  private readonly logger = new Logger(WhatsAppMetaService.name);

  constructor(
    private readonly credentialsService: IntegrationsCredentialsService,
  ) {}

  /** Validates X-Hub-Signature-256 using appSecret stored per business in integrations. */
  async verifySignature(
    rawBody: Buffer | string,
    signatureHeader?: string,
  ): Promise<boolean> {
    if (!signatureHeader?.startsWith('sha256=')) {
      return false;
    }

    const appSecrets = await this.credentialsService.listAppSecrets();
    if (!appSecrets.length) {
      this.logger.warn(
        'No WhatsApp appSecret in integrations; skipping webhook signature verification',
      );
      return true;
    }

    const expected = signatureHeader.slice(7);
    for (const secret of appSecrets) {
      if (this.matchesSignature(rawBody, expected, secret)) {
        return true;
      }
    }

    return false;
  }

  async sendTextMessage(
    credentials: WhatsAppIntegrationData,
    recipient: WhatsAppMessageRecipient | string,
    text: string,
  ): Promise<MetaSendTextResult> {
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`;
    const resolved: WhatsAppMessageRecipient =
      typeof recipient === 'string'
        ? { phone: recipient.replace(/\D/g, '') }
        : recipient;

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'text',
      text: { body: text },
    };
    if (resolved.phone) {
      body.to = resolved.phone.replace(/\D/g, '');
    }
    if (resolved.userId) {
      body.recipient = resolved.userId;
    }
    if (!body.to && !body.recipient) {
      throw new Error('WhatsApp recipient is required');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message: string };
    };

    if (!res.ok) {
      throw new Error(json.error?.message || 'WhatsApp send failed');
    }

    const metaMessageId = json.messages?.[0]?.id;
    if (!metaMessageId) {
      throw new Error('WhatsApp send returned no message id');
    }

    return { metaMessageId };
  }

  /** Marks an inbound customer message as read in WhatsApp (blue ticks for the customer). */
  async markMessageAsRead(
    credentials: WhatsAppIntegrationData,
    metaMessageId: string,
  ): Promise<void> {
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: metaMessageId,
      }),
    });

    const json = (await res.json()) as { error?: { message: string } };
    if (!res.ok) {
      throw new Error(json.error?.message || 'WhatsApp mark-as-read failed');
    }
  }

  /**
   * Returns the test/sandbox phone numbers registered for this Phone Number ID in Meta.
   * When the endpoint responds successfully the account is in sandbox/test mode.
   */
  async listTestPhoneNumbers(
    credentials: WhatsAppIntegrationData,
  ): Promise<{ phoneNumbers: WhatsAppTestPhoneNumber[]; isSandbox: boolean }> {
    const { ok, json } = await this.graphGet<{
      data?: { display_phone_number?: string }[];
      error?: MetaGraphError;
    }>(credentials, `${credentials.phoneNumberId}/whatsapp_test_phone_numbers`);

    if (!ok) {
      // Production accounts return 400/404 for this endpoint
      return { phoneNumbers: [], isSandbox: false };
    }

    const phoneNumbers = (json.data ?? [])
      .map((row) => ({
        phoneNumber: (row.display_phone_number ?? '').replace(/\D/g, ''),
      }))
      .filter((row) => row.phoneNumber.length > 0);

    return { phoneNumbers, isSandbox: true };
  }

  /**
   * Exchanges an OAuth authorization code from FB.login (Embedded Signup),
   * resolves WABA + Phone Number ID, and returns credentials to persist.
   */
  async connectViaOAuthCode(code: string): Promise<MetaOAuthConnectResult> {
    const { appId, appSecret } = this.getMetaAppCredentials();
    const oauthExchange = await this.exchangeEmbeddedSignupOAuthCode(
      code,
      appId,
      appSecret,
    );
    const longLivedExchange = await this.exchangeLongLivedToken(
      oauthExchange.accessToken,
      appId,
      appSecret,
    );
    const accessToken = longLivedExchange.accessToken;

    const credentials: WhatsAppIntegrationData = {
      phoneNumberId: 'pending',
      accessToken,
      appSecret,
    };

    const debug = await this.fetchAccessTokenDebugPayload(credentials);
    const wabaIds = this.extractWabaIdsFromDebug(
      (debug.data as MetaDebugTokenData | undefined) ?? {},
    );
    if (!wabaIds.length) {
      throw new Error(
        'No se encontró una cuenta de WhatsApp Business (WABA) en el token de Meta. Verifica los permisos de la app.',
      );
    }

    const wabaId = wabaIds[0];
    const phoneListing = await this.listWabaPhoneNumbers(credentials, wabaId);
    const phoneNumberId = phoneListing.phoneNumberId;

    credentials.phoneNumberId = phoneNumberId;
    const phoneNumberDetails = await this.fetchPhoneNumberDetails(
      credentials,
      phoneNumberId,
    );

    // Subscribe our Meta app to this customer's WABA so its inbound messages and
    // status updates are delivered to the shared app-level webhook. Without this
    // the single Embedded Signup webhook never receives events for the business.
    let appSubscribed = false;
    let appSubscriptionError: string | undefined;
    try {
      await this.subscribeAppToWaba(credentials, wabaId);
      appSubscribed = true;
    } catch (err) {
      appSubscriptionError =
        err instanceof Error ? err.message : 'No se pudo suscribir la app a la WABA';
      this.logger.warn(
        `WABA ${wabaId} app subscription failed: ${appSubscriptionError}`,
      );
    }

    const embeddedSignup: MetaEmbeddedSignupSnapshot = {
      connectedAt: new Date().toISOString(),
      oauthAccessTokenExchange: redactMetaAccessTokenPayload(
        oauthExchange.rawResponse,
      ),
      longLivedTokenExchange: redactMetaAccessTokenPayload(
        longLivedExchange.rawResponse,
      ),
      debugToken: debug,
      wabaIds,
      selectedWabaId: wabaId,
      phoneNumbersListing: phoneListing.rawResponse,
      selectedPhoneNumberId: phoneNumberId,
      phoneNumberDetails,
      appSubscribed,
      appSubscriptionError,
    };

    return { accessToken, wabaId, phoneNumberId, embeddedSignup };
  }

  /**
   * Subscribes our Meta app to a customer's WABA webhooks
   * (POST /{waba-id}/subscribed_apps). Required for Embedded Signup so events
   * for that business reach the single shared app-level webhook callback.
   */
  async subscribeAppToWaba(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
  ): Promise<void> {
    const { ok, json } = await this.graphPostAbsolute<
      MetaGraphResponse & { success?: boolean }
    >(credentials, `${wabaId}/subscribed_apps`, {});

    if (!ok || json.success === false) {
      throw new Error(
        json.error?.message ||
          'No se pudo suscribir la app a la cuenta de WhatsApp Business (WABA).',
      );
    }
  }

  async listMessageTemplates(
    credentials: WhatsAppIntegrationData,
    options?: { approvedOnly?: boolean },
  ): Promise<WhatsAppTemplateSummary[]> {
    const wabaId = await this.getWabaIdForBusiness(credentials);
    const { ok, json } = await this.graphGet<{
      data?: MetaMessageTemplate[];
      error?: MetaGraphError;
    }>(credentials, `${wabaId}/message_templates`, {
      fields: 'name,status,language,category,components',
      limit: '100',
    });

    if (!ok) {
      throw new Error(
        json.error?.message || 'No se pudieron cargar las plantillas',
      );
    }

    const approvedOnly = options?.approvedOnly !== false;

    return (json.data ?? [])
      .filter((row) => !approvedOnly || row.status === 'APPROVED')
      .map((row) => this.mapMessageTemplate(row))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async createMessageTemplate(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
    payload: {
      name: string;
      language: string;
      category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';
      headerText?: string;
      headerExamples?: string[];
      bodyText: string;
      bodyExamples: string[];
      footerText?: string;
      buttons?: Array<{
        type: 'URL' | 'QUICK_REPLY';
        text: string;
        url?: string;
      }>;
    },
  ): Promise<{ id: string; status: string; category: string }> {
    const components = buildMetaTemplateComponents({
      headerText: payload.headerText,
      headerExamples: payload.headerExamples,
      bodyText: payload.bodyText,
      bodyExamples: payload.bodyExamples,
      footerText: payload.footerText,
      buttons: payload.buttons,
    });

    const { ok, json } = await this.graphPostAbsolute<
      MetaGraphResponse & { id?: string; status?: string; category?: string }
    >(credentials, `${wabaId}/message_templates`, {
      name: payload.name,
      language: payload.language,
      category: payload.category,
      allow_category_change: true,
      components,
    });

    if (!ok || !json.id) {
      const metaError = json.error as MetaGraphError & {
        error_user_msg?: string;
      };
      throw new Error(
        metaError?.error_user_msg?.trim() ||
          metaError?.message ||
          'No se pudo crear la plantilla en Meta',
      );
    }

    return {
      id: String(json.id),
      status: json.status ?? 'PENDING',
      category: json.category ?? payload.category,
    };
  }

  async deleteMessageTemplateByName(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
    name: string,
  ): Promise<boolean> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${wabaId}/message_templates`;
    const url = `${base}?name=${encodeURIComponent(name)}`;

    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    return res.ok;
  }

  async sendTemplateMessage(
    credentials: WhatsAppIntegrationData,
    recipient: WhatsAppMessageRecipient | string,
    templateName: string,
    languageCode: string,
    bodyParameters: string[] = [],
  ): Promise<MetaSendTextResult> {
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`;
    const resolved: WhatsAppMessageRecipient =
      typeof recipient === 'string'
        ? { phone: recipient.replace(/\D/g, '') }
        : recipient;

    const template: Record<string, unknown> = {
      name: templateName,
      language: { code: languageCode },
    };

    if (bodyParameters.length) {
      template.components = [
        {
          type: 'body',
          parameters: bodyParameters.map((text) => ({ type: 'text', text })),
        },
      ];
    }

    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      type: 'template',
      template,
    };
    if (resolved.phone) {
      body.to = resolved.phone.replace(/\D/g, '');
    }
    if (resolved.userId) {
      body.recipient = resolved.userId;
    }
    if (!body.to && !body.recipient) {
      throw new Error('WhatsApp recipient is required');
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as {
      messages?: { id: string }[];
      error?: { message: string };
    };

    if (!res.ok) {
      throw new Error(json.error?.message || 'WhatsApp template send failed');
    }

    const metaMessageId = json.messages?.[0]?.id;
    if (!metaMessageId) {
      throw new Error('WhatsApp template send returned no message id');
    }

    return { metaMessageId };
  }

  /**
   * Registers the phone number for Cloud API messaging (fixes error 133010).
   *
   * The `pin` is the two-step verification PIN. For numbers onboarded through
   * Embedded Signup the number is already verified by Meta, so registration only
   * requires setting/sending this PIN — there is no SMS code involved.
   */
  async registerPhoneNumber(
    credentials: WhatsAppIntegrationData,
    pin: string,
    useSystemUserToken = false,
  ): Promise<void> {
    const normalizedPin = pin?.trim();
    if (!normalizedPin) {
      throw new Error('Se requiere un PIN de 6 dígitos para registrar el número.');
    }

    const { ok, json } = await this.graphPost(credentials, 'register', {
      body: {
        messaging_product: 'whatsapp',
        pin: normalizedPin,
      },
      accessToken: this.resolveAccessTokenForPhoneRegistration(
        credentials,
        useSystemUserToken,
      ),
    });

    if (!ok) {
      throw new Error(
        json.error?.message || 'No se pudo registrar el número en Cloud API',
      );
    }
  }

  /**
   * Resolves the WhatsApp Business Account (WABA) that owns phoneNumberId.
   * The phone number node does not expose `whatsapp_business_account` in Graph v25.
   */
  async getWabaIdForBusiness(
    credentials: WhatsAppIntegrationData,
  ): Promise<string> {
    const wabaIds = await this.resolveWabaIdsFromToken(credentials);
    if (!wabaIds.length) {
      const diagnosis = await this.diagnoseCredentials(credentials);
      const detail = [...diagnosis.issues, ...diagnosis.hints][0];
      throw new Error(
        detail ??
          'El token no tiene permisos de WhatsApp Business Management sobre ninguna cuenta WABA.',
      );
    }

    if (wabaIds.length === 1) {
      return wabaIds[0];
    }

    for (const wabaId of wabaIds) {
      if (
        await this.wabaOwnsPhoneNumber(
          credentials,
          wabaId,
          credentials.phoneNumberId,
        )
      ) {
        return wabaId;
      }
    }

    throw new Error(
      'No se pudo asociar el identificador del número de teléfono con ninguna cuenta WABA del token.',
    );
  }

  private async resolveWabaIdsFromToken(
    credentials: WhatsAppIntegrationData,
  ): Promise<string[]> {
    const debug = await this.inspectAccessToken(credentials);
    return this.extractWabaIdsFromDebug(debug);
  }

  async diagnoseCredentials(
    credentials: WhatsAppIntegrationData,
  ): Promise<WhatsAppTokenDiagnostics> {
    const issues: string[] = [];
    const hints: string[] = [];
    const phoneNumberIdConfigured = credentials.phoneNumberId?.trim() ?? '';

    if (!phoneNumberIdConfigured) {
      issues.push('Falta el identificador del número de teléfono.');
    } else if (isPlaceholderPhoneNumberId(phoneNumberIdConfigured)) {
      issues.push(
        'El identificador del número está ofuscado o incompleto. Vuelve a ingresar el Phone Number ID completo de Meta.',
      );
    } else if (/[^0-9]/.test(phoneNumberIdConfigured)) {
      issues.push(
        'El identificador del número parece incorrecto: contiene caracteres no numéricos. Debe ser el Phone Number ID de Meta (solo dígitos), no el número de teléfono (+57…).',
      );
    }

    if (!credentials.accessToken?.trim()) {
      issues.push('Falta el token de acceso.');
    } else if (isPlaceholderSecret(credentials.accessToken)) {
      issues.push(
        'El token de acceso está ofuscado. Vuelve a ingresar el token permanente del System User.',
      );
    }

    if (!credentials.appSecret?.trim()) {
      issues.push('Falta la clave secreta de la app.');
    } else if (isPlaceholderSecret(credentials.appSecret)) {
      issues.push(
        'La clave secreta de la app está ofuscada. Vuelve a ingresar el App Secret de Meta.',
      );
    }

    let debug: MetaDebugTokenData = {};
    try {
      debug = await this.inspectAccessToken(credentials);
    } catch (err) {
      issues.push(
        err instanceof Error
          ? err.message
          : 'No se pudo inspeccionar el token con Meta.',
      );
    }

    const scopes = debug.scopes ?? [];
    const granularScopes = (debug.granular_scopes ?? []).map((entry) => ({
      scope: entry.scope ?? '',
      targetIds: [...(entry.target_ids ?? [])],
    }));
    const wabaIdsFromManagement = this.extractWabaIdsFromDebug(debug);

    if (debug.is_valid === false) {
      issues.push('Meta indica que el token no es válido o expiró.');
      hints.push(
        'El token temporal de "API Setup" en developers.facebook.com caduca en 24 h. Usa un token permanente del System User en Business Manager.',
      );
    }

    if (
      scopes.includes('whatsapp_business_messaging') &&
      !scopes.includes('whatsapp_business_management')
    ) {
      issues.push(
        'El token solo tiene whatsapp_business_messaging. Enviar mensajes puede funcionar, pero listar/registrar plantillas requiere whatsapp_business_management.',
      );
    }

    if (
      debug.is_valid !== false &&
      scopes.length &&
      !scopes.includes('whatsapp_business_messaging')
    ) {
      issues.push(
        'El token no incluye whatsapp_business_messaging. No podrás enviar mensajes desde Vyva.',
      );
      hints.push(
        'Genera un token con el permiso whatsapp_business_messaging en Business Manager → Usuarios del sistema.',
      );
    }

    const managementEntry = granularScopes.find(
      (entry) => entry.scope === 'whatsapp_business_management',
    );
    if (
      scopes.includes('whatsapp_business_management') &&
      !managementEntry?.targetIds.length
    ) {
      issues.push(
        'Meta no devolvió ninguna cuenta WABA asociada al permiso whatsapp_business_management (target_ids vacío).',
      );
      hints.push(
        'En Business Manager → Usuarios del sistema, asigna la cuenta de WhatsApp Business al System User y genera un token con ambos permisos sobre ese activo.',
      );
    }

    if (!wabaIdsFromManagement.length && debug.is_valid !== false) {
      issues.push(
        'No se encontró ninguna WABA en el token. Las plantillas y operaciones de gestión fallarán.',
      );
    }

    let phoneNumberIdReachable = false;
    let phoneNumberDisplay: string | undefined;
    if (phoneNumberIdConfigured && credentials.accessToken?.trim()) {
      const { ok, json } = await this.graphGet<{
        display_phone_number?: string;
        verified_name?: string;
        error?: MetaGraphError;
      }>(credentials, phoneNumberIdConfigured, {
        fields: 'display_phone_number,verified_name',
      });
      phoneNumberIdReachable = ok;
      if (ok) {
        phoneNumberDisplay =
          json.display_phone_number ?? json.verified_name ?? undefined;
      } else {
        issues.push(
          `Meta no reconoce el Phone Number ID configurado (${phoneNumberIdConfigured}): ${json.error?.message ?? 'error desconocido'}.`,
        );
        hints.push(
          'Copia el "Phone number ID" desde WhatsApp → API Setup en developers.facebook.com. No uses el WABA ID ni el número en formato +57….',
        );
      }
    }

    let phoneNumberBelongsToWaba: boolean | null = null;
    let resolvedWabaId: string | undefined;
    if (wabaIdsFromManagement.length && phoneNumberIdConfigured) {
      for (const wabaId of wabaIdsFromManagement) {
        if (
          await this.wabaOwnsPhoneNumber(
            credentials,
            wabaId,
            phoneNumberIdConfigured,
          )
        ) {
          phoneNumberBelongsToWaba = true;
          resolvedWabaId = wabaId;
          break;
        }
      }
      if (phoneNumberBelongsToWaba === null) {
        phoneNumberBelongsToWaba = false;
        issues.push(
          'El Phone Number ID configurado no pertenece a ninguna WABA accesible con este token.',
        );
        hints.push(
          'Verifica que el token y el Phone Number ID sean de la misma app y la misma cuenta de WhatsApp Business.',
        );
      }
    }

    if (
      phoneNumberIdReachable &&
      wabaIdsFromManagement.length &&
      phoneNumberBelongsToWaba === false
    ) {
      hints.push(
        `Posible confusión de IDs: el valor ${phoneNumberIdConfigured} responde como número de teléfono en Meta, pero no está en las WABAs del token (${wabaIdsFromManagement.join(', ')}).`,
      );
    }

    const wabaForBusinessLookup = resolvedWabaId ?? wabaIdsFromManagement[0];
    let metaBusinessId: string | undefined;
    if (wabaForBusinessLookup && credentials.accessToken?.trim()) {
      metaBusinessId = await this.getMetaBusinessIdForWaba(
        credentials,
        wabaForBusinessLookup,
      );
    }

    return {
      phoneNumberIdConfigured,
      tokenValid: debug.is_valid !== false,
      tokenType: debug.type,
      appId: debug.app_id,
      tokenExpiresAt: debug.expires_at,
      scopes,
      granularScopes,
      wabaIdsFromManagement,
      phoneNumberIdReachable,
      phoneNumberDisplay,
      phoneNumberBelongsToWaba,
      resolvedWabaId,
      metaBusinessId,
      issues,
      hints,
    };
  }

  /**
   * Meta debug_token requires an app access token (or app admin user token) as bearer.
   * Business tokens from Embedded Signup cannot inspect themselves; use `{app_id}|{app_secret}`.
   */
  private async inspectAccessToken(
    credentials: WhatsAppIntegrationData,
  ): Promise<MetaDebugTokenData> {
    const inputToken = credentials.accessToken.trim();
    const appId = process.env.META_APP_ID?.trim();
    const appSecret =
      credentials.appSecret?.trim() || process.env.META_APP_SECRET?.trim();

    if (appId && appSecret) {
      const appAccessToken = `${appId}|${appSecret}`;
      const withAppToken = await this.fetchDebugToken(
        appAccessToken,
        inputToken,
      );
      if (withAppToken.ok && withAppToken.json.data) {
        return withAppToken.json.data;
      }

      const appTokenError = withAppToken.json.error?.message;
      if (appTokenError) {
        this.logger.warn(
          `debug_token with app access token failed: ${appTokenError}`,
        );
        throw new Error(appTokenError);
      }
    }

    const initial = await this.fetchDebugToken(inputToken, inputToken);
    if (initial.ok && initial.json.data) {
      return initial.json.data;
    }

    throw new Error(
      initial.json.error?.message ||
        'No se pudo validar el token para obtener la cuenta WABA',
    );
  }

  private async fetchDebugToken(
    bearerToken: string,
    inputToken: string,
  ): Promise<{
    ok: boolean;
    json: { data?: MetaDebugTokenData; error?: MetaGraphError };
  }> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}`;
    const url = `${base}/debug_token?${new URLSearchParams({
      input_token: inputToken,
    }).toString()}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    const json = (await res.json()) as {
      data?: MetaDebugTokenData;
      error?: MetaGraphError;
    };
    return { ok: res.ok, json };
  }

  private extractWabaIdsFromDebug(debug: MetaDebugTokenData): string[] {
    const wabaIds = new Set<string>();
    for (const entry of debug.granular_scopes ?? []) {
      if (entry.scope !== 'whatsapp_business_management') {
        continue;
      }
      for (const id of entry.target_ids ?? []) {
        wabaIds.add(id);
      }
    }
    return [...wabaIds];
  }

  private getMetaAppCredentials(): { appId: string; appSecret: string } {
    const appId = process.env.META_APP_ID?.trim();
    const appSecret = process.env.META_APP_SECRET?.trim();
    if (!appId || !appSecret) {
      throw new Error(
        'Meta OAuth no está configurado en el servidor (META_APP_ID / META_APP_SECRET).',
      );
    }
    return { appId, appSecret };
  }

  private async exchangeEmbeddedSignupOAuthCode(
    code: string,
    appId: string,
    appSecret: string,
  ): Promise<{ accessToken: string; rawResponse: Record<string, unknown> }> {
    this.logger.log(
      'Meta Embedded Signup: exchanging authorization code without redirect_uri',
    );

    try {
      return await this.exchangeOAuthCode(code, appId, appSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Meta Embedded Signup code exchange failed: ${message}`,
      );
      throw err;
    }
  }

  private async exchangeOAuthCode(
    code: string,
    appId: string,
    appSecret: string,
    redirectUri?: string,
  ): Promise<{ accessToken: string; rawResponse: Record<string, unknown> }> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/oauth/access_token`;
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code: code.trim(),
    });
    const normalizedRedirect = this.normalizeRedirectUri(redirectUri);
    if (normalizedRedirect) {
      params.set('redirect_uri', normalizedRedirect);
      this.logger.log(
        `Meta OAuth code exchange using redirect_uri=${normalizedRedirect}`,
      );
    }

    const res = await fetch(`${base}?${params.toString()}`);
    const json = (await res.json()) as {
      access_token?: string;
      error?: MetaGraphError & { error_subcode?: number; fbtrace_id?: string };
    };

    if (!res.ok || !json.access_token) {
      const metaError = json.error;
      if (metaError) {
        this.logger.error(
          `Meta OAuth token exchange error: ${JSON.stringify(metaError)}`,
        );
      }
      throw new Error(
        this.formatOAuthExchangeError(metaError?.message, normalizedRedirect),
      );
    }

    return {
      accessToken: json.access_token,
      rawResponse: json as unknown as Record<string, unknown>,
    };
  }

  private formatOAuthExchangeError(
    metaMessage?: string,
    redirectUri?: string,
  ): string {
    const base =
      metaMessage?.trim() ||
      'No se pudo intercambiar el código de autorización de Meta.';

    if (/verification code|redirect_uri/i.test(base)) {
      return (
        `${base} ` +
        'Para Embedded Signup el intercambio debe hacerse sin redirect_uri y el código ' +
        'caduca en ~30 s y solo sirve una vez. Completa el flujo en Meta y pulsa Comenzar de nuevo ' +
        'sin reutilizar el mismo código ni probarlo manualmente en Postman.' +
        (redirectUri ? ` (redirect_uri enviado: ${redirectUri})` : '')
      );
    }

    return base;
  }

  private normalizeRedirectUri(value?: string): string | undefined {
    const trimmed = value?.trim();
    if (!trimmed) {
      return undefined;
    }
    return trimmed.replace(/\/$/, '');
  }

  private async exchangeLongLivedToken(
    shortLivedToken: string,
    appId: string,
    appSecret: string,
  ): Promise<{ accessToken: string; rawResponse: Record<string, unknown> }> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/oauth/access_token`;
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    });

    const res = await fetch(`${base}?${params.toString()}`);
    const json = (await res.json()) as {
      access_token?: string;
      error?: MetaGraphError;
    };

    if (!res.ok || !json.access_token) {
      return {
        accessToken: shortLivedToken,
        rawResponse: json as unknown as Record<string, unknown>,
      };
    }

    return {
      accessToken: json.access_token,
      rawResponse: json as unknown as Record<string, unknown>,
    };
  }

  private async listWabaPhoneNumbers(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
  ): Promise<{ phoneNumberId: string; rawResponse: Record<string, unknown> }> {
    const { ok, json } = await this.graphGet<{
      data?: { id?: string }[];
      error?: MetaGraphError;
    }>(credentials, `${wabaId}/phone_numbers`, {
      fields: 'id,display_phone_number,verified_name,code_verification_status',
      limit: '25',
    });

    if (!ok) {
      throw new Error(
        json.error?.message ||
          'No se pudieron listar los números de teléfono de la cuenta WABA.',
      );
    }

    const phoneNumberId = json.data?.[0]?.id?.trim();
    if (!phoneNumberId) {
      throw new Error(
        'La cuenta de WhatsApp Business no tiene números de teléfono asociados.',
      );
    }

    return {
      phoneNumberId,
      rawResponse: json as unknown as Record<string, unknown>,
    };
  }

  private async fetchPhoneNumberDetails(
    credentials: WhatsAppIntegrationData,
    phoneNumberId: string,
  ): Promise<Record<string, unknown>> {
    const { ok, json } = await this.graphGet<
      Record<string, unknown> & {
        error?: MetaGraphError;
      }
    >(credentials, phoneNumberId, {
      fields:
        'display_phone_number,verified_name,code_verification_status,quality_rating,messaging_limit_tier,status',
    });

    if (!ok) {
      return {
        error: json.error,
        response: json,
      };
    }

    return json as Record<string, unknown>;
  }

  private async fetchAccessTokenDebugPayload(
    credentials: WhatsAppIntegrationData,
  ): Promise<Record<string, unknown>> {
    const inputToken = credentials.accessToken.trim();
    const appId = process.env.META_APP_ID?.trim();
    const appSecret =
      credentials.appSecret?.trim() || process.env.META_APP_SECRET?.trim();

    if (appId && appSecret) {
      const appAccessToken = `${appId}|${appSecret}`;
      const withAppToken = await this.fetchDebugToken(
        appAccessToken,
        inputToken,
      );
      return withAppToken.json as unknown as Record<string, unknown>;
    }

    const initial = await this.fetchDebugToken(inputToken, inputToken);
    return initial.json as unknown as Record<string, unknown>;
  }

  private async findPrimaryPhoneNumberId(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
  ): Promise<string> {
    const { ok, json } = await this.graphGet<{
      data?: { id?: string }[];
      error?: MetaGraphError;
    }>(credentials, `${wabaId}/phone_numbers`, {
      fields: 'id',
      limit: '25',
    });

    if (!ok) {
      throw new Error(
        json.error?.message ||
          'No se pudieron listar los números de teléfono de la cuenta WABA.',
      );
    }

    const phoneNumberId = json.data?.[0]?.id?.trim();
    if (!phoneNumberId) {
      throw new Error(
        'La cuenta de WhatsApp Business no tiene números de teléfono asociados.',
      );
    }

    return phoneNumberId;
  }

  private async getMetaBusinessIdForWaba(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
  ): Promise<string | undefined> {
    const { ok, json } = await this.graphGet<{
      owner_business_info?: { id?: string };
      error?: MetaGraphError;
    }>(credentials, wabaId, {
      fields: 'owner_business_info',
    });

    if (!ok) {
      return undefined;
    }

    return json.owner_business_info?.id?.trim() || undefined;
  }

  private async wabaOwnsPhoneNumber(
    credentials: WhatsAppIntegrationData,
    wabaId: string,
    phoneNumberId: string,
  ): Promise<boolean> {
    const { ok, json } = await this.graphGet<{
      data?: { id?: string }[];
      error?: MetaGraphError;
    }>(credentials, `${wabaId}/phone_numbers`, {
      fields: 'id',
      limit: '100',
    });

    if (!ok) {
      return false;
    }

    return (json.data ?? []).some((row) => row.id === phoneNumberId);
  }

  private mapMessageTemplate(
    row: MetaMessageTemplate,
  ): WhatsAppTemplateSummary {
    const header = row.components?.find(
      (component) => component.type === 'HEADER',
    );
    const body = row.components?.find((component) => component.type === 'BODY');
    const footer = row.components?.find(
      (component) => component.type === 'FOOTER',
    );
    const preview =
      [header?.text?.trim(), body?.text?.trim(), footer?.text?.trim()]
        .filter(Boolean)
        .join('\n') || row.name;
    const bodyParameterCount = (preview.match(/\{\{\d+\}\}/g) ?? []).length;

    return {
      name: row.name,
      language: row.language,
      category: row.category,
      status: row.status,
      preview,
      bodyParameterCount,
    };
  }

  /**
   * Phone registration APIs use META_SYSTEM_USER_ACCESS_TOKEN only when
   * useSystemUserToken is true; otherwise the client OAuth token is used.
   */
  private resolveAccessTokenForPhoneRegistration(
    credentials: WhatsAppIntegrationData,
    useSystemUserToken = false,
  ): string {
    if (useSystemUserToken) {
      const systemUserToken = process.env.META_SYSTEM_USER_ACCESS_TOKEN?.trim();
      if (!systemUserToken) {
        throw new Error(
          'META_SYSTEM_USER_ACCESS_TOKEN no está configurado en el servidor.',
        );
      }
      return systemUserToken;
    }

    return credentials.accessToken.trim();
  }

  async getFullBusinessProfile(
    credentials: WhatsAppIntegrationData,
  ): Promise<WhatsAppBusinessProfile> {
    const [profile, displayName, username] = await Promise.all([
      this.getBusinessProfile(credentials),
      this.getPhoneNumberDisplayName(credentials),
      this.getBusinessUsername(credentials),
    ]);
    return { ...profile, ...displayName, ...username };
  }

  async getBusinessUsername(
    credentials: WhatsAppIntegrationData,
  ): Promise<Pick<WhatsAppBusinessProfile, 'username' | 'usernameStatus'>> {
    const { ok, json } = await this.graphGet<
      MetaGraphResponse & {
        username?: string;
        status?: string;
      }
    >(credentials, `${credentials.phoneNumberId}/username`);

    if (!ok) {
      return {};
    }

    return {
      username: json.username?.trim() || undefined,
      usernameStatus: json.status?.trim() || undefined,
    };
  }

  async getBusinessUsernameSuggestions(
    credentials: WhatsAppIntegrationData,
  ): Promise<string[]> {
    const { ok, json } = await this.graphGet<
      MetaGraphResponse & {
        username_suggestions?: string[];
      }
    >(credentials, `${credentials.phoneNumberId}/username_suggestions`);

    if (!ok) {
      return [];
    }

    return (json.username_suggestions ?? [])
      .map((entry) => entry?.trim())
      .filter(Boolean);
  }

  async updateBusinessUsername(
    credentials: WhatsAppIntegrationData,
    username: string,
    transferAction?: 'none' | 'force_transfer',
  ): Promise<Pick<WhatsAppBusinessProfile, 'username' | 'usernameStatus'>> {
    const normalized = username.trim().replace(/^@/, '');
    const body: Record<string, unknown> = { username: normalized };
    if (transferAction) {
      body.transfer_action = transferAction;
    }

    const { ok, json } = await this.graphPostAbsolute<
      MetaGraphResponse & {
        username?: string;
        status?: string;
      }
    >(credentials, `${credentials.phoneNumberId}/username`, body);

    if (!ok) {
      const message =
        json.error?.message ??
        'No se pudo actualizar el nombre de usuario de WhatsApp.';
      const err = new Error(message) as Error & { metaErrorCode?: number };
      err.metaErrorCode = json.error?.code;
      throw err;
    }

    return {
      username: json.username?.trim() || normalized,
      usernameStatus: json.status?.trim() || undefined,
    };
  }

  async deleteBusinessUsername(
    credentials: WhatsAppIntegrationData,
  ): Promise<boolean> {
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}/username`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    if (!res.ok) {
      const json = (await res.json()) as MetaGraphResponse;
      const message =
        json.error?.message ??
        'No se pudo eliminar el nombre de usuario de WhatsApp.';
      const err = new Error(message) as Error & { metaErrorCode?: number };
      err.metaErrorCode = json.error?.code;
      throw err;
    }

    return true;
  }

  async getPhoneNumberDisplayName(
    credentials: WhatsAppIntegrationData,
  ): Promise<
    Pick<
      WhatsAppBusinessProfile,
      | 'verifiedName'
      | 'newDisplayName'
      | 'nameStatus'
      | 'newNameStatus'
      | 'displayNameEditable'
    >
  > {
    const { ok, json } = await this.graphGet<
      MetaGraphResponse & {
        verified_name?: string;
        new_display_name?: string;
        name_status?: string;
        new_name_status?: string;
      }
    >(credentials, credentials.phoneNumberId, {
      fields: 'verified_name,new_display_name,name_status,new_name_status',
    });

    if (!ok) {
      throw new Error(
        json.error?.message ??
          'No se pudo obtener el nombre visible de WhatsApp.',
      );
    }

    const pendingStatuses = new Set(['PENDING', 'PENDING_REVIEW']);
    const nameStatus = json.name_status?.trim() || undefined;
    const newNameStatus = json.new_name_status?.trim() || undefined;
    const displayNameEditable =
      !pendingStatuses.has(nameStatus ?? '') &&
      !pendingStatuses.has(newNameStatus ?? '');

    return {
      verifiedName: json.verified_name?.trim() || undefined,
      newDisplayName: json.new_display_name?.trim() || undefined,
      nameStatus,
      newNameStatus,
      displayNameEditable,
    };
  }

  async updatePhoneNumberDisplayName(
    credentials: WhatsAppIntegrationData,
    newDisplayName: string,
  ): Promise<void> {
    const trimmed = newDisplayName.trim();
    if (!trimmed) {
      return;
    }

    const { ok, json } = await this.graphPostAbsolute<MetaGraphResponse>(
      credentials,
      credentials.phoneNumberId,
      { new_display_name: trimmed },
    );

    if (!ok) {
      throw new Error(
        json.error?.message ??
          'No se pudo solicitar el cambio de nombre visible en WhatsApp.',
      );
    }
  }

  async uploadProfilePictureHandle(
    credentials: WhatsAppIntegrationData,
    fileBuffer: Buffer,
    mimeType: string,
    fileName: string,
  ): Promise<string> {
    const { appId } = this.getMetaAppCredentials();
    const accessToken = credentials.accessToken.trim();
    const normalizedMime =
      mimeType === 'image/jpg' ? 'image/jpeg' : mimeType;
    const allowed = new Set(['image/jpeg', 'image/png']);
    if (!allowed.has(normalizedMime)) {
      throw new Error(
        'Formato de imagen no soportado. Usa JPEG o PNG para el perfil de WhatsApp.',
      );
    }

    const sessionParams = new URLSearchParams({
      file_name: fileName,
      file_length: String(fileBuffer.length),
      file_type: normalizedMime,
    });
    const sessionUrl = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${appId}/uploads?${sessionParams.toString()}`;
    const sessionRes = await fetch(sessionUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const sessionJson = (await sessionRes.json()) as MetaGraphResponse & {
      id?: string;
    };
    if (!sessionRes.ok || !sessionJson.id?.trim()) {
      throw new Error(
        sessionJson.error?.message ??
          'No se pudo iniciar la subida de la foto de perfil en Meta.',
      );
    }

    const uploadRes = await fetch(
      `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${sessionJson.id.trim()}`,
      {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${accessToken}`,
          file_offset: '0',
          'Content-Type': 'application/octet-stream',
        },
        body: fileBuffer,
      },
    );
    const uploadJson = (await uploadRes.json()) as MetaGraphResponse & {
      h?: string;
    };
    if (!uploadRes.ok || !uploadJson.h?.trim()) {
      throw new Error(
        uploadJson.error?.message ??
          'No se pudo subir la foto de perfil a Meta.',
      );
    }

    return uploadJson.h.trim();
  }

  async getBusinessProfile(
    credentials: WhatsAppIntegrationData,
  ): Promise<WhatsAppBusinessProfile> {
    const fields =
      'about,address,description,email,profile_picture_url,websites,vertical';
    const { ok, json } = await this.graphGet<
      MetaGraphResponse & {
        data?: Array<{
          about?: string;
          address?: string;
          description?: string;
          email?: string;
          profile_picture_url?: string;
          websites?: string[];
          vertical?: string;
        }>;
      }
    >(
      credentials,
      `${credentials.phoneNumberId}/whatsapp_business_profile`,
      { fields },
    );

    if (!ok) {
      throw new Error(
        json.error?.message ??
          'No se pudo obtener el perfil de WhatsApp Business.',
      );
    }

    const row = json.data?.[0];
    if (!row) {
      return {};
    }

    return {
      about: row.about?.trim() || undefined,
      address: row.address?.trim() || undefined,
      description: row.description?.trim() || undefined,
      email: row.email?.trim() || undefined,
      profilePictureUrl: row.profile_picture_url?.trim() || undefined,
      websites: (row.websites ?? []).filter(Boolean),
      vertical: row.vertical?.trim() || undefined,
    };
  }

  async updateBusinessProfile(
    credentials: WhatsAppIntegrationData,
    input: UpdateWhatsAppBusinessProfileInput,
  ): Promise<void> {
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
    };

    if (input.about !== undefined) {
      body.about = input.about.trim();
    }
    if (input.address !== undefined) {
      body.address = input.address.trim();
    }
    if (input.description !== undefined) {
      body.description = input.description.trim();
    }
    if (input.email !== undefined) {
      body.email = input.email.trim();
    }
    if (input.vertical !== undefined) {
      body.vertical = input.vertical.trim();
    }
    if (input.websites !== undefined) {
      body.websites = input.websites
        .map((url) => url.trim())
        .filter(Boolean)
        .slice(0, 2);
    }
    if (input.profilePictureHandle?.trim()) {
      body.profile_picture_handle = input.profilePictureHandle.trim();
    }

    const { ok, json } = await this.graphPost(credentials, 'whatsapp_business_profile', {
      body,
    });

    if (!ok) {
      throw new Error(
        json.error?.message ??
          'No se pudo actualizar el perfil de WhatsApp Business.',
      );
    }
  }

  private async graphGet<T extends MetaGraphResponse>(
    credentials: WhatsAppIntegrationData,
    resourcePath: string,
    query?: Record<string, string> & { accessToken?: string },
  ): Promise<{ ok: boolean; json: T }> {
    const { accessToken, ...queryParams } = query ?? {};
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}`;
    const qs = Object.keys(queryParams).length
      ? `?${new URLSearchParams(queryParams).toString()}`
      : '';
    const url = `${base}/${resourcePath}${qs}`;
    const bearerToken = accessToken?.trim() || credentials.accessToken.trim();

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
      },
    });

    const json = (await res.json()) as T;
    return { ok: res.ok, json };
  }

  private async graphPostAbsolute<T extends MetaGraphResponse>(
    credentials: WhatsAppIntegrationData,
    resourcePath: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; json: T }> {
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${resourcePath}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as T;
    return { ok: res.ok, json };
  }

  private async graphPost(
    credentials: WhatsAppIntegrationData,
    resourcePath: string,
    options?: {
      query?: Record<string, string>;
      body?: Record<string, unknown>;
      accessToken?: string;
    },
  ): Promise<{ ok: boolean; json: MetaGraphResponse }> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}`;
    const qs = options?.query
      ? `?${new URLSearchParams(options.query).toString()}`
      : '';
    const url = `${base}/${resourcePath}${qs}`;
    const bearerToken =
      options?.accessToken?.trim() || credentials.accessToken.trim();

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const json = (await res.json()) as MetaGraphResponse;
    return { ok: res.ok, json };
  }

  /** Descarga el binario de un media de WhatsApp Cloud API por su id de Meta. */
  async fetchMediaBuffer(
    credentials: WhatsAppIntegrationData,
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const trimmedId = mediaId.trim();
    if (!trimmedId) {
      throw new Error('WhatsApp media id is required');
    }

    const metaUrl = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${trimmedId}`;
    const metaRes = await fetch(metaUrl, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    const metaJson = (await metaRes.json()) as {
      url?: string;
      mime_type?: string;
      error?: { message?: string };
    };

    if (!metaRes.ok || !metaJson.url) {
      throw new Error(
        metaJson.error?.message || 'Could not resolve WhatsApp media URL',
      );
    }

    const fileRes = await fetch(metaJson.url, {
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
      },
    });

    if (!fileRes.ok) {
      throw new Error('Could not download WhatsApp media');
    }

    const buffer = Buffer.from(await fileRes.arrayBuffer());
    const mimeType =
      metaJson.mime_type ||
      fileRes.headers.get('content-type') ||
      'application/octet-stream';

    return { buffer, mimeType };
  }

  private matchesSignature(
    rawBody: Buffer | string,
    expectedHex: string,
    appSecret: string,
  ): boolean {
    const hmac = createHmac('sha256', appSecret);
    hmac.update(rawBody);
    const digest = hmac.digest('hex');
    try {
      return timingSafeEqual(Buffer.from(digest), Buffer.from(expectedHex));
    } catch {
      return false;
    }
  }
}
