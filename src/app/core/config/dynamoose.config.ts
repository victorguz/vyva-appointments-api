import { ConfigService } from '@nestjs/config';
import { DynamooseModuleOptions } from 'nestjs-dynamoose';
import { Environment } from './environment.config';

export const dynamooseConfig = (
  configService: ConfigService,
): DynamooseModuleOptions => {
  const nodeEnv = configService.get('NODE_ENV');
  const isDevelopment = nodeEnv === Environment.Development;

  return {
    aws: {
      accessKeyId: configService.get('ACCESS_KEY_ID'),
      secretAccessKey: configService.get('SECRET_ACCESS_KEY'),
      region: configService.get('REGION'),
    },
    local: false,
    // logger: !isProduction,
    table: {
      prefix: `${nodeEnv}-vyva-`,
      // Solo crear tablas automáticamente en desarrollo local
      // En QAS/PRD las tablas deben existir previamente
      create: isDevelopment,
      // Initialize debe estar en true para poder usar tablas existentes
      initialize: true,
      waitForActive: false,
    },
  };
};
