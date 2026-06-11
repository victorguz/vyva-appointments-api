import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { WhatsAppIntegrationData } from '../../schemas/integration.schema';
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
  issues: string[];
  hints: string[];
}

interface MetaGraphResponse {
  success?: boolean;
  error?: MetaGraphError;
}

export interface RequestVerificationCodeResult {
  codeSent: boolean;
  alreadyVerified?: boolean;
}

export interface WhatsAppTemplateSummary {
  name: string;
  language: string;
  category?: string;
  preview: string;
  bodyParameterCount: number;
}

export interface WhatsAppTestPhoneNumber {
  /** E.164 phone number string from Meta */
  phoneNumber: string;
}

export interface MetaOAuthConnectResult {
  accessToken: string;
  wabaId: string;
  phoneNumberId: string;
}

interface MetaTemplateComponent {
  type?: string;
  text?: string;
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
    toPhone: string,
    text: string,
  ): Promise<MetaSendTextResult> {
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`;
    const to = toPhone.replace(/\D/g, '');

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { body: text },
      }),
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

  /**
   * Returns the test/sandbox phone numbers registered for this Phone Number ID in Meta.
   * Only relevant for test mode accounts; returns an empty array for production accounts.
   */
  async listTestPhoneNumbers(
    credentials: WhatsAppIntegrationData,
  ): Promise<WhatsAppTestPhoneNumber[]> {
    const { ok, json } = await this.graphGet<{
      data?: { display_phone_number?: string }[];
      error?: MetaGraphError;
    }>(credentials, `${credentials.phoneNumberId}/whatsapp_test_phone_numbers`);

    if (!ok) {
      // Production accounts return 400/404 for this endpoint — treat as empty list
      return [];
    }

    return (json.data ?? [])
      .map((row) => ({
        phoneNumber: (row.display_phone_number ?? '').replace(/\D/g, ''),
      }))
      .filter((row) => row.phoneNumber.length > 0);
  }

  /**
   * Exchanges an OAuth authorization code from FB.login (Embedded Signup),
   * resolves WABA + Phone Number ID, and returns credentials to persist.
   */
  async connectViaOAuthCode(
    code: string,
    redirectUri?: string,
  ): Promise<MetaOAuthConnectResult> {
    const { appId, appSecret } = this.getMetaAppCredentials();
    const redirect =
      redirectUri?.trim() ||
      process.env.META_OAUTH_REDIRECT_URI?.trim() ||
      process.env.FRONTEND_URL?.trim() ||
      '';

    const shortLived = await this.exchangeOAuthCode(
      code,
      appId,
      appSecret,
      redirect,
    );
    const accessToken = await this.exchangeLongLivedToken(
      shortLived,
      appId,
      appSecret,
    );

    const credentials: WhatsAppIntegrationData = {
      phoneNumberId: 'pending',
      accessToken,
      appSecret,
    };

    const debug = await this.inspectAccessToken(credentials);
    const wabaIds = this.extractWabaIdsFromDebug(debug);
    if (!wabaIds.length) {
      throw new Error(
        'No se encontró una cuenta de WhatsApp Business (WABA) en el token de Meta. Verifica los permisos de la app.',
      );
    }

    const wabaId = wabaIds[0];
    const phoneNumberId = await this.findPrimaryPhoneNumberId(
      credentials,
      wabaId,
    );

    return { accessToken, wabaId, phoneNumberId };
  }

  async listMessageTemplates(
    credentials: WhatsAppIntegrationData,
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

    return (json.data ?? [])
      .filter((row) => row.status === 'APPROVED')
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
      bodyText: string;
      bodyExamples: string[];
    },
  ): Promise<{ id: string; status: string; category: string }> {
    const bodyComponent: Record<string, unknown> = {
      type: 'BODY',
      text: payload.bodyText,
    };

    if (payload.bodyExamples.length) {
      bodyComponent.example = { body_text: [payload.bodyExamples] };
    }

    const { ok, json } = await this.graphPostAbsolute<
      MetaGraphResponse & { id?: string; status?: string; category?: string }
    >(credentials, `${wabaId}/message_templates`, {
      name: payload.name,
      language: payload.language,
      category: payload.category,
      allow_category_change: true,
      components: [bodyComponent],
    });

    if (!ok || !json.id) {
      throw new Error(
        json.error?.message || 'No se pudo crear la plantilla en Meta',
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
    toPhone: string,
    templateName: string,
    languageCode: string,
    bodyParameters: string[] = [],
  ): Promise<MetaSendTextResult> {
    const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}/messages`;
    const to = toPhone.replace(/\D/g, '');

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

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template,
      }),
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

  /** Requests Meta to send an SMS verification code to the business phone number. */
  async requestVerificationCode(
    credentials: WhatsAppIntegrationData,
  ): Promise<RequestVerificationCodeResult> {
    const { ok, json } = await this.graphPost(credentials, 'request_code', {
      query: { code_method: 'SMS', language: 'es' },
    });

    if (ok) {
      return { codeSent: true };
    }

    if (json.error?.code === 136024) {
      return { codeSent: false, alreadyVerified: true };
    }

    throw new Error(
      json.error?.message || 'No se pudo solicitar el código de verificación',
    );
  }

  /** Verifies the SMS code. Returns false when the number was already verified. */
  async verifyCode(
    credentials: WhatsAppIntegrationData,
    code: string,
  ): Promise<boolean> {
    const { ok, json } = await this.graphPost(credentials, 'verify_code', {
      query: { code },
    });

    if (ok) {
      return true;
    }

    if (json.error?.code === 136024) {
      return false;
    }

    throw new Error(json.error?.message || 'Código de verificación inválido');
  }

  /** Registers the phone number for Cloud API messaging (fixes error 133010). */
  async registerPhoneNumber(
    credentials: WhatsAppIntegrationData,
    pin: string,
  ): Promise<void> {
    const { ok, json } = await this.graphPost(credentials, 'register', {
      body: {
        messaging_product: 'whatsapp',
        pin,
      },
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
    } else if (/[^0-9]/.test(phoneNumberIdConfigured)) {
      issues.push(
        'El identificador del número parece incorrecto: contiene caracteres no numéricos. Debe ser el Phone Number ID de Meta (solo dígitos), no el número de teléfono (+57…).',
      );
    }

    if (!credentials.accessToken?.trim()) {
      issues.push('Falta el token de acceso.');
    }

    if (!credentials.appSecret?.trim()) {
      issues.push('Falta la clave secreta de la app.');
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
      issues,
      hints,
    };
  }

  /**
   * Meta debug_token requires an app access token (or app admin user token) as bearer.
   * We first read app_id from the token, then re-inspect with `{app_id}|{app_secret}`.
   */
  private async inspectAccessToken(
    credentials: WhatsAppIntegrationData,
  ): Promise<MetaDebugTokenData> {
    const inputToken = credentials.accessToken.trim();
    const initial = await this.fetchDebugToken(inputToken, inputToken);
    if (!initial.ok) {
      throw new Error(
        initial.json.error?.message ||
          'No se pudo validar el token para obtener la cuenta WABA',
      );
    }

    const appId = initial.json.data?.app_id;
    const appSecret = credentials.appSecret?.trim();
    if (!appId || !appSecret) {
      return initial.json.data ?? {};
    }

    const appAccessToken = `${appId}|${appSecret}`;
    const refined = await this.fetchDebugToken(appAccessToken, inputToken);
    if (refined.ok && refined.json.data) {
      return refined.json.data;
    }

    return initial.json.data ?? {};
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

  private async exchangeOAuthCode(
    code: string,
    appId: string,
    appSecret: string,
    redirectUri: string,
  ): Promise<string> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/oauth/access_token`;
    const params = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      code: code.trim(),
    });
    if (redirectUri) {
      params.set('redirect_uri', redirectUri);
    }

    const res = await fetch(`${base}?${params.toString()}`);
    const json = (await res.json()) as {
      access_token?: string;
      error?: MetaGraphError;
    };

    if (!res.ok || !json.access_token) {
      throw new Error(
        json.error?.message ||
          'No se pudo intercambiar el código de autorización de Meta.',
      );
    }

    return json.access_token;
  }

  private async exchangeLongLivedToken(
    shortLivedToken: string,
    appId: string,
    appSecret: string,
  ): Promise<string> {
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
      return shortLivedToken;
    }

    return json.access_token;
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
    const body = row.components?.find((component) => component.type === 'BODY');
    const preview = body?.text?.trim() || row.name;
    const bodyParameterCount = (preview.match(/\{\{\d+\}\}/g) ?? []).length;

    return {
      name: row.name,
      language: row.language,
      category: row.category,
      preview,
      bodyParameterCount,
    };
  }

  private async graphGet<T extends MetaGraphResponse>(
    credentials: WhatsAppIntegrationData,
    resourcePath: string,
    query?: Record<string, string>,
  ): Promise<{ ok: boolean; json: T }> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}`;
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    const url = `${base}/${resourcePath}${qs}`;

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
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
    },
  ): Promise<{ ok: boolean; json: MetaGraphResponse }> {
    const base = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${credentials.phoneNumberId}`;
    const qs = options?.query
      ? `?${new URLSearchParams(options.query).toString()}`
      : '';
    const url = `${base}/${resourcePath}${qs}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: options?.body ? JSON.stringify(options.body) : undefined,
    });

    const json = (await res.json()) as MetaGraphResponse;
    return { ok: res.ok, json };
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
