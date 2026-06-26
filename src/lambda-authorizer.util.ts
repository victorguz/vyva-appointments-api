import {
  EdgeUserContext,
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

export function injectAuthorizerContextIntoEvent(
  event: Record<string, unknown> | undefined,
): void {
  const authorizerContext = extractAuthorizerContextFromEvent(event);
  if (!authorizerContext?.sub || !event) return;

  const headers = (event.headers ?? {}) as Record<string, string | undefined>;
  event.headers = headers;

  if (headers['x-vyva-user'] || headers['X-Vyva-User']) {
    return;
  }

  const payload = JSON.stringify(authorizerContext);
  headers['x-vyva-user'] = payload;
  headers['X-Vyva-User'] = payload;
}
