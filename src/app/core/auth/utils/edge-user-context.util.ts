import { Request } from 'express';

export interface EdgeUserContext {
  sub: string;
  idBusiness?: string;
  role?: string;
  email?: string;
  authType?: 'jwt' | 'apiKey';
}

export function extractEdgeUserContext(
  request: Request,
): EdgeUserContext | undefined {
  const fromAuthorizer = extractFromApiGatewayAuthorizer(request);
  if (fromAuthorizer) return fromAuthorizer;
  return extractFromVyvaUserHeader(request);
}

function extractFromApiGatewayAuthorizer(
  request: Request,
): EdgeUserContext | undefined {
  const apiGatewayEvent = resolveApiGatewayEvent(request);
  if (!apiGatewayEvent) return undefined;

  const requestContext = apiGatewayEvent.requestContext as
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

function resolveApiGatewayEvent(
  request: Request,
): Record<string, unknown> | undefined {
  const fromMiddleware = (request as any).apiGateway?.event as
    | Record<string, unknown>
    | undefined;
  if (fromMiddleware) return fromMiddleware;

  const encodedEvent = request.headers['x-apigateway-event'];
  const rawValue =
    typeof encodedEvent === 'string'
      ? encodedEvent
      : Array.isArray(encodedEvent)
        ? encodedEvent[0]
        : undefined;

  if (!rawValue) return undefined;

  try {
    return JSON.parse(decodeURIComponent(rawValue)) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

export function mapAuthorizerContext(
  context: Record<string, string>,
): EdgeUserContext {
  return {
    sub: context.sub,
    idBusiness: context.idBusiness || undefined,
    role: context.role || undefined,
    email: context.email || undefined,
    authType: context.authType as EdgeUserContext['authType'],
  };
}

function extractFromVyvaUserHeader(
  request: Request,
): EdgeUserContext | undefined {
  const rawHeader = request.headers['x-vyva-user'];
  const rawValue =
    typeof rawHeader === 'string'
      ? rawHeader
      : Array.isArray(rawHeader)
        ? rawHeader[0]
        : undefined;

  if (!rawValue) return undefined;

  try {
    const parsed = JSON.parse(rawValue) as EdgeUserContext;
    if (!parsed || typeof parsed !== 'object' || !parsed.sub) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}
