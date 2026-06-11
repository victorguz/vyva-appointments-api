import { Module } from '@nestjs/common';
import { DynamooseModule } from 'nestjs-dynamoose';

import { WhatsAppMessageSchema } from '../../schemas/whatsapp-message.schema';
import { WhatsAppConversationSchema } from '../../schemas/whatsapp-conversation.schema';
import { IntegrationSchema } from '../../schemas/integration.schema';
import { UserSchema } from '../../schemas/user.schema';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { IntegrationsCredentialsService } from './integrations-credentials.service';
import { WhatsAppMetaService } from './whatsapp-meta.service';

@Module({
  imports: [
    DynamooseModule.forFeature([
      {
        name: 'WhatsAppMessage',
        schema: WhatsAppMessageSchema,
        options: { tableName: 'whatsapp-messages' },
      },
      {
        name: 'WhatsAppConversation',
        schema: WhatsAppConversationSchema,
        options: { tableName: 'whatsapp-conversations' },
      },
      {
        name: 'Integration',
        schema: IntegrationSchema,
        options: { tableName: 'integrations' },
      },
      {
        name: 'User',
        schema: UserSchema,
        options: { tableName: 'users' },
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
