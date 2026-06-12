import { ConfigService } from '@nestjs/config';
import { DynamooseModuleOptions } from 'nestjs-dynamoose';
import { Environment } from './environment.config';

/** Conversations/messages always use production tables (shared webhook data). */
export const WHATSAPP_DATA_TABLE_PREFIX = `${Environment.Production}-vyva-`;

export const getRuntimeTablePrefix = (nodeEnv: string): string =>
  `${nodeEnv}-vyva-`;

export const dynamooseConfig = (
  configService: ConfigService,
): DynamooseModuleOptions => {
  const nodeEnv = configService.get('NODE_ENV');

  return {
    aws: {
      accessKeyId: configService.get('ACCESS_KEY_ID'),
      secretAccessKey: configService.get('SECRET_ACCESS_KEY'),
      region: configService.get('REGION'),
    },
    local: false,
    // logger: !isProduction,
    table: {
      prefix: getRuntimeTablePrefix(nodeEnv),
      // Tablas existentes en QAS/PRD; create se desactiva por modelo en forFeature
      create: false,
      // Initialize debe estar en true para poder usar tablas existentes
      initialize: true,
      waitForActive: false,
      throughput: 'ON_DEMAND',
    },
  };
};
