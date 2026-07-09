import { ConfigService } from '@nestjs/config';
import { DynamooseModuleOptions } from 'nestjs-dynamoose';

export const getRuntimeTablePrefix = (nodeEnv: string): string =>
  `${nodeEnv}-vyva-`;

export const getWhatsAppMessagesTableName = (nodeEnv: string): string =>
  `${getRuntimeTablePrefix(nodeEnv)}whatsapp-messages`;

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
    table: {
      prefix: getRuntimeTablePrefix(nodeEnv),
      create: false,
      initialize: true,
      waitForActive: false,
      throughput: 'ON_DEMAND',
    },
  };
};
