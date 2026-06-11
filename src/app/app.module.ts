import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { configModuleOptions } from './core/config/environment.config';
import { dynamooseConfig } from './core/config/dynamoose.config';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    DynamooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) =>
        dynamooseConfig(configService),
      inject: [ConfigService],
    }),
    WhatsAppModule,
  ],
})
export class AppModule {}
