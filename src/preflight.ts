import {
  APIGatewayProxyEventV2,
  APIGatewayProxyResultV2,
} from 'aws-lambda';

function resolveAllowOrigin(requestOrigin?: string): string {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.trim() || '*';
  if (configured === '*') {
    return requestOrigin || '*';
  }

  const allowed = configured
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (requestOrigin && allowed.includes(requestOrigin)) {
    return requestOrigin;
  }

  return allowed[0] ?? '*';
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const requestOrigin = event.headers?.origin ?? event.headers?.Origin;

  return {
    statusCode: 204,
    headers: {
      'Access-Control-Allow-Origin': resolveAllowOrigin(requestOrigin),
      'Access-Control-Allow-Methods':
        process.env.CORS_ALLOWED_METHODS?.trim() ||
        'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers':
        process.env.CORS_ALLOWED_HEADERS?.trim() ||
        'Content-Type,Accept,Authorization,X-Requested-With,Application,Origin,x-api-key,api-key,x-apikey,x-api-bid,api-bid',
      'Access-Control-Max-Age': '86400',
    },
    body: '',
  };
}
