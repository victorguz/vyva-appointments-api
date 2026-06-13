import { Module } from '@nestjs/common';
import { DynamooseModule } from 'nestjs-dynamoose';

import { WHATSAPP_DATA_TABLE_PREFIX } from '../../core/config/dynamoose.config';
import { WhatsAppMessageSchema } from '../../schemas/whatsapp-message.schema';
import { WhatsAppConversationSchema } from '../../schemas/whatsapp-conversation.schema';
import { IntegrationSchema } from '../../schemas/integration.schema';
import { DomainSchema } from '../../schemas/domain.schema';
import { UserSchema } from '../../schemas/user.schema';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { IntegrationsCredentialsService } from './integrations-credentials.service';
import { WhatsAppMetaService } from './whatsapp-meta.service';

const whatsappDataTableOptions = {
  prefix: WHATSAPP_DATA_TABLE_PREFIX,
  create: false,
};

@Module({
  imports: [
    DynamooseModule.forFeature([
      {
        name: 'WhatsAppMessage',
        schema: WhatsAppMessageSchema,
        options: {
          tableName: 'whatsapp-messages',
          ...whatsappDataTableOptions,
        },
      },
      {
        name: 'WhatsAppConversation',
        schema: WhatsAppConversationSchema,
        options: {
          tableName: 'whatsapp-conversations',
          ...whatsappDataTableOptions,
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
    IntegrationsCredentialsService,
    WhatsAppMetaService,
  ],
})
export class WhatsAppModule {}
