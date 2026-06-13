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
  const event = (request as any).apiGateway?.event;
  const lambdaContext = event?.requestContext?.authorizer?.lambda;
  if (lambdaContext?.sub) {
    return mapAuthorizerContext(lambdaContext);
  }

  const legacyContext = event?.requestContext?.authorizer;
  if (legacyContext?.sub) {
    return mapAuthorizerContext(legacyContext);
  }

  return undefined;
}

function mapAuthorizerContext(
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
