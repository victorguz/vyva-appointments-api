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

  @IsString()
  ACCESS_KEY_ID: string;

  @IsString()
  SECRET_ACCESS_KEY: string;

  @IsString()
  REGION: string;
}

const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('dev', 'qas', 'prd')
    .default('dev'),
  PORT: Joi.number().default(3000),
  ERROR_LOGS: Joi.boolean().default(false),
  JWT_SECRET: Joi.string().required(),
  SECRET_KEY: Joi.string().required(),
  ACCESS_KEY_ID: Joi.string().optional(),
  SECRET_ACCESS_KEY: Joi.string().optional(),
  REGION: Joi.string().optional(),
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
