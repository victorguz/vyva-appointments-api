export interface WhatsAppMessageContent {
  type: string;
  body?: string;
  media?: Record<string, unknown>;
  replyToMetaMessageId?: string;
}

function mediaPayload(
  media: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!media?.id) {
    return undefined;
  }
  return {
    mediaId: media.id,
    mimeType: media.mime_type,
    sha256: media.sha256,
    caption: media.caption,
  };
}

export function extractWhatsAppMessageContent(
  msg: Record<string, unknown>,
): WhatsAppMessageContent {
  const type = (msg.type as string) || 'text';
  const context = msg.context as Record<string, unknown> | undefined;
  const replyToMetaMessageId = context?.message_id as string | undefined;

  switch (type) {
    case 'text':
      return {
        type,
        body: (msg.text as { body?: string })?.body,
        replyToMetaMessageId,
      };
    case 'image':
      return {
        type,
        body:
          (msg.image as { caption?: string })?.caption ||
          '[Imagen]',
        media: mediaPayload(msg.image as Record<string, unknown>),
        replyToMetaMessageId,
      };
    case 'audio':
      return {
        type,
        body: (msg.audio as { voice?: boolean })?.voice
          ? '[Nota de voz]'
          : '[Audio]',
        media: mediaPayload(msg.audio as Record<string, unknown>),
        replyToMetaMessageId,
      };
    case 'video':
      return {
        type,
        body:
          (msg.video as { caption?: string })?.caption ||
          '[Video]',
        media: mediaPayload(msg.video as Record<string, unknown>),
        replyToMetaMessageId,
      };
    case 'document':
      return {
        type,
        body:
          (msg.document as { filename?: string })?.filename ||
          '[Documento]',
        media: mediaPayload(msg.document as Record<string, unknown>),
        replyToMetaMessageId,
      };
    case 'sticker':
      return {
        type,
        body: '[Sticker]',
        media: mediaPayload(msg.sticker as Record<string, unknown>),
        replyToMetaMessageId,
      };
    case 'location': {
      const location = msg.location as
        | { latitude?: number; longitude?: number; name?: string; address?: string }
        | undefined;
      const label =
        location?.name ||
        location?.address ||
        (location?.latitude != null && location?.longitude != null
          ? `${location.latitude}, ${location.longitude}`
          : '[Ubicación]');
      return {
        type,
        body: label,
        media: location
          ? {
              latitude: location.latitude,
              longitude: location.longitude,
              name: location.name,
              address: location.address,
            }
          : undefined,
        replyToMetaMessageId,
      };
    }
    case 'contacts': {
      const contacts = msg.contacts as
        | { name?: { formatted_name?: string } }[]
        | undefined;
      const names =
        contacts
          ?.map((c) => c.name?.formatted_name)
          .filter(Boolean)
          .join(', ') || '[Contacto]';
      return { type, body: names, replyToMetaMessageId };
    }
    case 'interactive': {
      const interactive = msg.interactive as
        | {
            type?: string;
            button_reply?: { title?: string };
            list_reply?: { title?: string; description?: string };
          }
        | undefined;
      const body =
        interactive?.button_reply?.title ||
        interactive?.list_reply?.title ||
        interactive?.list_reply?.description ||
        `[Interactivo: ${interactive?.type ?? 'unknown'}]`;
      return { type, body, replyToMetaMessageId };
    }
    case 'button':
      return {
        type,
        body:
          (msg.button as { text?: string })?.text ||
          (msg.button as { payload?: string })?.payload ||
          '[Botón]',
        replyToMetaMessageId,
      };
    case 'reaction':
      return {
        type,
        body: (msg.reaction as { emoji?: string })?.emoji || '[Reacción]',
        replyToMetaMessageId,
      };
    case 'order':
      return {
        type,
        body: '[Pedido]',
        replyToMetaMessageId,
      };
    case 'system':
      return {
        type,
        body:
          (msg.system as { body?: string })?.body ||
          '[Mensaje del sistema]',
        replyToMetaMessageId,
      };
    default:
      return { type, body: `[${type}]`, replyToMetaMessageId };
  }
}

const INBOUND_MEDIA_TYPES = new Set([
  'image',
  'audio',
  'video',
  'sticker',
  'document',
]);

export function isInboundMediaMessageType(type: string): boolean {
  return INBOUND_MEDIA_TYPES.has(type);
}

/** Obtiene el mediaId de Meta guardado en payload.media al persistir el mensaje. */
export function extractMediaIdFromMessagePayload(
  payloadJson?: string,
): string | null {
  if (!payloadJson?.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadJson) as {
      media?: { mediaId?: string; id?: string };
    };
    const mediaId = payload.media?.mediaId ?? payload.media?.id;
    return typeof mediaId === 'string' && mediaId.trim() ? mediaId.trim() : null;
  } catch {
    return null;
  }
}

/** URL S3 persistida tras la primera carga bajo demanda del media. */
export function extractMediaStorageUrlFromMessagePayload(
  payloadJson?: string,
): string | null {
  if (!payloadJson?.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadJson) as {
      media?: { storageUrl?: string; url?: string };
    };
    const url = payload.media?.storageUrl ?? payload.media?.url;
    return typeof url === 'string' && url.trim() ? url.trim() : null;
  } catch {
    return null;
  }
}

/** Ruta S3 persistida tras la primera descarga bajo demanda del media. */
export function extractMediaStorageRouteFromMessagePayload(
  payloadJson?: string,
): string | null {
  if (!payloadJson?.trim()) {
    return null;
  }
  try {
    const payload = JSON.parse(payloadJson) as {
      media?: { storageRoute?: string; route?: string };
    };
    const route = payload.media?.storageRoute ?? payload.media?.route;
    return typeof route === 'string' && route.trim() ? route.trim() : null;
  } catch {
    return null;
  }
}

export function mergeMediaStorageIntoPayload(
  payloadJson: string | undefined,
  storage: { url: string; route: string },
): string {
  let payload: Record<string, unknown> = {};
  if (payloadJson?.trim()) {
    try {
      payload = JSON.parse(payloadJson) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  const media =
    payload.media && typeof payload.media === 'object'
      ? { ...(payload.media as Record<string, unknown>) }
      : {};

  media.storageUrl = storage.url;
  media.storageRoute = storage.route;
  payload.media = media;

  return JSON.stringify(payload);
}

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
  'application/pdf': 'pdf',
};

export function extensionFromMimeType(mimeType: string): string {
  const normalized = mimeType.split(';')[0].trim().toLowerCase();
  if (MIME_EXTENSION[normalized]) {
    return MIME_EXTENSION[normalized];
  }
  const subtype = normalized.split('/')[1];
  return subtype?.replace(/[^a-z0-9]/gi, '') || 'bin';
}

export function defaultMediaFileName(
  messageType: string,
  mimeType: string,
  preferredName?: string,
): string {
  const trimmed = preferredName?.trim();
  if (trimmed) {
    return trimmed.replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  const ext = extensionFromMimeType(mimeType);
  return `${messageType}.${ext}`;
}

export function parseWhatsAppStatusErrors(
  statusErrors?: string,
): { code?: number; title?: string; message?: string }[] {
  if (!statusErrors?.trim()) {
    return [];
  }
  try {
    const parsed = JSON.parse(statusErrors);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
