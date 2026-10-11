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

  // La cabecera `x-vyva-user` no la firma nadie: solo se acepta cuando no
  // pudo venir de internet (ver `canTrustVyvaUserHeader`). Si no, una ruta sin
  // authorizer (las `/public/*`) dejaría suplantar a cualquier usuario.
  if (!canTrustVyvaUserHeader(request)) return undefined;
  return extractFromVyvaUserHeader(request);
}

/**
 * `true` si el evento entró por API Gateway (HTTP API, REST o Function URL).
 * AWS siempre puebla `apiId`/`requestId`/`accountId` y el cliente no puede
 * falsearlos; la invocación Lambda directa entre servicios no los trae.
 */
export function isApiGatewayEvent(
  event: Record<string, unknown> | undefined,
): boolean {
  const requestContext = event?.requestContext as
    | Record<string, unknown>
    | undefined;
  if (!requestContext) return false;

  return Boolean(
    requestContext.apiId ||
      requestContext.identity ||
      requestContext.requestId ||
      requestContext.accountId,
  );
}

/**
 * La cabecera solo vale en dos casos:
 * - Invocación Lambda directa desde otro servicio (LambdaInvokeService): hace
 *   falta permiso IAM, así que es de confianza.
 * - Desarrollo local con `nest start`, fuera de Lambda y sin authorizer.
 *
 * aws-serverless-express reescribe siempre `x-apigateway-event` con el evento
 * real, así que dentro de Lambda esa cabecera no es falsificable desde fuera.
 */
function canTrustVyvaUserHeader(request: Request): boolean {
  const event = resolveApiGatewayEvent(request);
  if (event) return !isApiGatewayEvent(event);
  return !process.env.AWS_LAMBDA_FUNCTION_NAME;
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
