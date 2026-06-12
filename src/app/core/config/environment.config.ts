import { ConfigModuleOptions } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  validateSync,
} from 'class-validator';
import * as Joi from 'joi';

export enum Environment {
  Development = 'dev',
  Production = 'prd',
  Quality = 'qas',
}
export const EnvironmentValues = {
  domain: {
    [Environment.Development]: 'http://localhost:4200',
    [Environment.Quality]: 'https://qas.vyvapos.com',
    [Environment.Production]: 'https://app.vyvapos.com',
  },
};
export const JWT_EXPIRATION =
  process.env.NODE_ENV == Environment.Development ? '7d' : '24h';

export const isProduction: boolean =
  process.env.NODE_ENV == Environment.Production;

export class EnvironmentVariables {
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  @IsOptional()
  PORT: number = 3000;

  @IsBoolean()
  @IsOptional()
  ERROR_LOGS: boolean = false;

  @IsString()
  JWT_SECRET: string;

  @IsString()
  SECRET_KEY: string;

  @IsOptional()
  @IsString()
  ACCESS_KEY_ID?: string;

  @IsOptional()
  @IsString()
  SECRET_ACCESS_KEY?: string;

  @IsOptional()
  @IsString()
  REGION?: string;

  @IsOptional()
  @IsString()
  VYVAPOS_ID_BUSINESS?: string;

  @IsOptional()
  @IsString()
  META_APP_ID?: string;

  @IsOptional()
  @IsString()
  META_APP_SECRET?: string;

  @IsOptional()
  @IsString()
  META_OAUTH_REDIRECT_URI?: string;

  @IsOptional()
  @IsString()
  FRONTEND_URL?: string;
}

const validationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('dev', 'qas', 'prd').default('dev'),
  PORT: Joi.number().default(3000),
  ERROR_LOGS: Joi.boolean().default(false),
  JWT_SECRET: Joi.string().required(),
  SECRET_KEY: Joi.string().required(),
  VYVAPOS_ID_BUSINESS: Joi.string().optional().allow(''),
  ACCESS_KEY_ID: Joi.string().optional(),
  SECRET_ACCESS_KEY: Joi.string().optional(),
  REGION: Joi.string().optional(),
  META_APP_ID: Joi.string().optional().allow(''),
  META_APP_SECRET: Joi.string().optional().allow(''),
  META_OAUTH_REDIRECT_URI: Joi.string().optional().allow(''),
  FRONTEND_URL: Joi.string().optional().allow(''),
});

function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false,
  });

  if (errors.length > 0) {
    throw Error(errors.toString());
  }
  return validatedConfig;
}

export const configModuleOptions: ConfigModuleOptions = {
  isGlobal: true,
  validationSchema,
  validate,
  validationOptions: {
    allowUnknown: false,
    abortEarly: true,
  },
};
