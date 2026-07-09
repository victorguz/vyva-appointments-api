import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const DEFAULT_ORIGINS = '*';
const DEFAULT_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const DEFAULT_HEADERS =
  'Content-Type,Accept,Authorization,X-Requested-With,Application,Origin,Access-Control-Allow-Origin,Access-Control-Allow-Credentials,x-api-bid,x-api-key,api-key,x-apikey';

function parseOrigins(value: string | undefined): CorsOptions['origin'] {
  const raw = value?.trim() || DEFAULT_ORIGINS;
  if (raw === '*') {
    return '*';
  }
  if (raw.includes(',')) {
    return raw.split(',').map((origin) => origin.trim());
  }
  return raw;
}

export function buildCorsOptions(
  overrides?: Partial<CorsOptions>,
): CorsOptions {
  return {
    origin: parseOrigins(process.env.CORS_ALLOWED_ORIGINS),
    methods: process.env.CORS_ALLOWED_METHODS?.trim() || DEFAULT_METHODS,
    allowedHeaders:
      process.env.CORS_ALLOWED_HEADERS?.trim() || DEFAULT_HEADERS,
    ...overrides,
  };
}
