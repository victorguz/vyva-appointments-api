import {
  EdgeUserContext,
  isApiGatewayEvent,
  mapAuthorizerContext,
} from './app/core/auth/utils/edge-user-context.util';

export function normalizeApiGatewayEvent(
  event: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!event || event.version !== '2.0') {
    return event;
  }

  const rawPath = typeof event.rawPath === 'string' ? event.rawPath : '/';
  const rawQueryString =
    typeof event.rawQueryString === 'string' ? event.rawQueryString : '';

  const requestContext = event.requestContext as
    | Record<string, unknown>
    | undefined;
  const http = requestContext?.http as Record<string, string> | undefined;

  return {
    ...event,
    path: rawPath,
    httpMethod: http?.method,
    queryStringParameters: parseQueryString(rawQueryString),
  };
}

function parseQueryString(
  rawQueryString: string,
): Record<string, string> | null {
  if (!rawQueryString) return null;

  const params = new URLSearchParams(rawQueryString);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }

  return Object.keys(result).length > 0 ? result : null;
}

export function extractAuthorizerContextFromEvent(
  event: Record<string, unknown> | undefined,
): EdgeUserContext | undefined {
  if (!event) return undefined;

  const requestContext = event.requestContext as
    | Record<string, unknown>
    | undefined;
  const authorizer = requestContext?.authorizer as
    | Record<string, unknown>
    | undefined;
  if (!authorizer) return undefined;

  const lambdaContext = authorizer.lambda as Record<string, string> | undefined;
  if (lambdaContext?.sub) {
    return mapAuthorizerContext(lambdaContext);
  }

  if (typeof authorizer.sub === 'string') {
    return mapAuthorizerContext(authorizer as Record<string, string>);
  }

  return undefined;
}

const VYVA_USER_HEADER = 'x-vyva-user';

/** Borra `x-vyva-user` (cualquier mayúscula) de `headers` y `multiValueHeaders`. */
export function removeVyvaUserHeader(event: Record<string, unknown>): void {
  for (const key of ['headers', 'multiValueHeaders']) {
    const bag = event[key] as Record<string, unknown> | null | undefined;
    if (!bag || typeof bag !== 'object') continue;
    for (const name of Object.keys(bag)) {
      if (name.toLowerCase() === VYVA_USER_HEADER) delete bag[name];
    }
  }
}

export function injectAuthorizerContextIntoEvent(
  event: Record<string, unknown> | undefined,
): void {
  if (!event) return;

  // Seguridad: lo que llega por API Gateway trae cabeceras del cliente. Las
  // rutas públicas no tienen authorizer, así que un `x-vyva-user` puesto a
  // mano suplantaría a cualquier usuario. Esa cabecera solo puede salir del
  // authorizer; la invocación Lambda directa entre servicios sí la conserva.
  if (isApiGatewayEvent(event)) removeVyvaUserHeader(event);

  const authorizerContext = extractAuthorizerContextFromEvent(event);
  if (!authorizerContext?.sub) return;

  // Con authorizer, su contexto manda sobre cualquier cabecera previa.
  removeVyvaUserHeader(event);
  const headers = (event.headers ?? {}) as Record<string, string | undefined>;
  event.headers = headers;

  const payload = JSON.stringify(authorizerContext);
  headers['x-vyva-user'] = payload;
  headers['X-Vyva-User'] = payload;
}
