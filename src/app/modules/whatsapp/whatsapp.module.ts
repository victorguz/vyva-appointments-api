import { Module } from '@nestjs/common';
import { DynamooseModule } from 'nestjs-dynamoose';

import { WhatsAppMessageSchema } from '../../schemas/whatsapp-message.schema';
import { WhatsAppConversationSchema } from '../../schemas/whatsapp-conversation.schema';
import { IntegrationSchema } from '../../schemas/integration.schema';
import { DomainSchema } from '../../schemas/domain.schema';
import { UserSchema } from '../../schemas/user.schema';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { CampaignBatchService } from './campaign-batch.service';
import { CampaignStatsService } from './campaign-stats.service';
import { IntegrationsCredentialsService } from './integrations-credentials.service';
import { WhatsAppMetaService } from './whatsapp-meta.service';
import { WhatsAppMediaFilesService } from './whatsapp-media-files.service';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { RealtimePublisherService } from './realtime-publisher.service';


@Module({
  imports: [
    DynamooseModule.forFeature([
      {
        name: 'WhatsAppMessage',
        schema: WhatsAppMessageSchema,
        options: {
          tableName: 'whatsapp-messages',
          create: true,
        },
      },
      {
        name: 'WhatsAppConversation',
        schema: WhatsAppConversationSchema,
        options: {
          tableName: 'whatsapp-conversations',
          create: true,
        },
      },
      {
        name: 'Integration',
        schema: IntegrationSchema,
        options: { tableName: 'integrations', create: false },
      },
      {
        name: 'User',
        schema: UserSchema,
        options: { tableName: 'users', create: false },
      },
      {
        name: 'Domain',
        schema: DomainSchema,
        options: { tableName: 'domains', create: false },
      },
    ]),
  ],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    CampaignBatchService,
    CampaignStatsService,
    IntegrationsCredentialsService,
    WhatsAppMetaService,
    WhatsAppMediaFilesService,
    LambdaInvokeService,
    RealtimePublisherService,
  ],
})
export class WhatsAppModule {}
