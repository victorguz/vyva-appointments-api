import { ApiProperty } from '@nestjs/swagger';
import { WhatsAppMessage } from '../../../schemas/whatsapp-message.schema';
import { WhatsAppMessageConfig } from '../../../shared/whatsapp-message-config.types';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsBoolean,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class SendWhatsAppMessageDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  idConversation?: string;

  @ApiProperty({ required: false, description: 'E.164 digits only' })
  @IsOptional()
  @IsString()
  waPhone?: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ description: 'Client idempotency key' })
  @IsString()
  @IsNotEmpty()
  clientMessageId: string;

  @ApiProperty({ required: false, description: 'Vyva CRM customer linked to this chat' })
  @IsOptional()
  @IsUUID()
  idCustomer?: string;

  @ApiProperty({ required: false, description: 'Display name stored on the conversation' })
  @IsOptional()
  @IsString()
  displayName?: string;
}

export class ListMessagesQueryDto {
  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiProperty({ required: false, description: 'Load messages before this timestamp (ms)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  before?: number;
}

export class WhatsAppMessagesPageDto {
  @ApiProperty({ type: [Object] })
  messages: WhatsAppMessage[];

  @ApiProperty({ required: false })
  lastInboundAt?: number;

  @ApiProperty()
  serviceWindowOpen: boolean;

  @ApiProperty({ required: false })
  serviceWindowExpiresAt?: number;
}

export class WhatsAppUnreadCountsDto {
  @ApiProperty()
  total: number;

  @ApiProperty({ type: Object })
  byConversationId: Record<string, number>;
}

export class WhatsAppTemplateDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  language: string;

  @ApiProperty({ required: false })
  category?: string;

  @ApiProperty()
  preview: string;

  @ApiProperty()
  bodyParameterCount: number;
}

export class AppointmentTemplateContextDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  serviceName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  employeeName?: string;

  @ApiProperty({ description: 'ISO string or epoch milliseconds' })
  @IsNotEmpty()
  startDate!: string | number;

  @ApiProperty({ required: false })
  @IsOptional()
  endDate?: string | number;
}

export class SendWhatsAppTemplateDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  idConversation?: string;

  @ApiProperty({ required: false, description: 'E.164 digits only' })
  @IsOptional()
  @IsString()
  waPhone?: string;

  @ApiProperty({
    required: false,
    description:
      'Required unless appointmentTemplateKey and appointmentContext are provided',
  })
  @ValidateIf((dto) => !dto.appointmentTemplateKey)
  @IsString()
  @IsNotEmpty()
  templateName?: string;

  @ApiProperty({
    example: 'es',
    required: false,
    description:
      'Required unless appointmentTemplateKey and appointmentContext are provided',
  })
  @ValidateIf((dto) => !dto.appointmentTemplateKey)
  @IsString()
  @IsNotEmpty()
  languageCode?: string;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(10)
  bodyParameters?: string[];

  @ApiProperty({ required: false, description: 'Rendered preview stored in chat history' })
  @IsOptional()
  @IsString()
  bodyPreview?: string;

  @ApiProperty({
    required: false,
    description: 'Meta template body with {{1}}, {{2}}, … placeholders',
  })
  @IsOptional()
  @IsString()
  templateBody?: string;

  @ApiProperty({
    required: false,
    description: 'CSV column names mapped to each template variable (same order)',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  bodyFieldMapping?: string[];

  @ApiProperty({ description: 'Client idempotency key' })
  @IsString()
  @IsNotEmpty()
  clientMessageId: string;

  @ApiProperty({ required: false, description: 'Vyva CRM customer linked to this chat' })
  @IsOptional()
  @IsUUID()
  idCustomer?: string;

  @ApiProperty({ required: false, description: 'Display name stored on the conversation' })
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiProperty({
    required: false,
    description: 'Marketing campaign id this template message belongs to',
  })
  @IsOptional()
  @IsString()
  idCampaign?: string;

  @ApiProperty({
    required: false,
    description:
      'Appointment owner business id; whatsapp-api resolves templates, routing and message body',
  })
  @IsOptional()
  @IsUUID()
  appointmentBusinessId?: string;

  @ApiProperty({
    required: false,
    enum: ['booking', 'pending', 'confirmed', 'completed'],
    description:
      'When set with appointmentContext, whatsapp-api builds templateName, languageCode and bodyParameters',
  })
  @IsOptional()
  @IsIn(['booking', 'pending', 'confirmed', 'completed'])
  appointmentTemplateKey?: 'booking' | 'pending' | 'confirmed' | 'completed';

  @ApiProperty({
    required: false,
    description:
      'Raw appointment data; whatsapp-api formats variables from whatsappMessages domain config',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AppointmentTemplateContextDto)
  appointmentContext?: AppointmentTemplateContextDto;
}

export class CampaignMessageRowDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  idConversation: string;

  @ApiProperty()
  waPhone: string;

  @ApiProperty({ required: false })
  displayName?: string;

  @ApiProperty({ required: false })
  idCustomer?: string;

  @ApiProperty({ required: false })
  body?: string;

  @ApiProperty({ description: 'pending | sent | delivered | read | failed' })
  status: string;

  @ApiProperty({ required: false })
  sentAt?: number;

  @ApiProperty({ required: false })
  deliveredAt?: number;

  @ApiProperty({ required: false })
  readAt?: number;

  @ApiProperty({ description: 'Whether the contact replied to the campaign' })
  responded: boolean;

  @ApiProperty({ required: false, description: 'Meta delivery error summary' })
  errorMessage?: string;

  @ApiProperty()
  timestamp: number;
}

export class LinkWhatsAppConversationCustomerDto {
  @ApiProperty()
  @IsUUID()
  idCustomer: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  displayName?: string;
}

export class RegisterTemplateButtonDto {
  @ApiProperty({ enum: ['URL', 'QUICK_REPLY'] })
  @IsString()
  @IsIn(['URL', 'QUICK_REPLY'])
  type: 'URL' | 'QUICK_REPLY';

  @ApiProperty({ example: 'Ir al chat' })
  @IsString()
  @IsNotEmpty()
  text: string;

  @ApiProperty({ example: 'https://app.vyvapos.com/b/crm/chat', required: false })
  @IsOptional()
  @IsString()
  url?: string;
}

export class RegisterTemplateItemDto {
  @ApiProperty({ description: 'Vyva template key (booking, pending, uuid, …)' })
  @IsString()
  @IsNotEmpty()
  key: string;

  @ApiProperty({ description: 'Meta template name (snake_case)' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: 'es' })
  @IsString()
  @IsNotEmpty()
  language: string;

  @ApiProperty({ enum: ['UTILITY', 'MARKETING', 'AUTHENTICATION'] })
  @IsString()
  @IsIn(['UTILITY', 'MARKETING', 'AUTHENTICATION'])
  category: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

  @ApiProperty({ description: 'Message body with Vyva variables {{customerName}}, …' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiProperty({ required: false, description: 'Meta HEADER text (max 60 chars)' })
  @IsOptional()
  @IsString()
  header?: string;

  @ApiProperty({ required: false, description: 'Meta FOOTER text (max 60 chars)' })
  @IsOptional()
  @IsString()
  footer?: string;

  @ApiProperty({ type: [RegisterTemplateButtonDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterTemplateButtonDto)
  buttons?: RegisterTemplateButtonDto[];
}

export class EnsureNotificationTemplatesDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  unansweredMessages?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  sales?: boolean;
}

export class RegisterTemplatesBatchDto {
  @ApiProperty({ type: [RegisterTemplateItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterTemplateItemDto)
  templates: RegisterTemplateItemDto[];
}

export class TemplateRegistrationResultDto {
  key: string;
  name: string;
  success: boolean;
  status?: string;
  metaTemplateId?: string;
  error?: string;
}

export class CompleteIntegrationSetupDto {
  @ApiProperty({
    required: false,
    description:
      'When true, Cloud API registration uses META_SYSTEM_USER_ACCESS_TOKEN from the server',
  })
  @IsOptional()
  @IsBoolean()
  useSystemUserToken?: boolean;
}

export class IntegrationSetupResultDto {
  phoneRegistered: boolean;
  templatesRegistered: boolean;
  setupComplete: boolean;
  setupError?: string;
  phoneRegistrationError?: string;
  templatesRegistrationError?: string;
  templateResults?: TemplateRegistrationResultDto[];
}

export class MetaOAuthCallbackDto {
  @ApiProperty({ description: 'Authorization code from Meta FB.login' })
  @IsString()
  @IsNotEmpty()
  code: string;

  @ApiProperty({
    required: false,
    description: 'Page URL where FB.login was initiated (must match Meta app config)',
  })
  @IsOptional()
  @IsString()
  redirectUri?: string;
}

export class SaveWhatsAppTestUserDto {
  @ApiProperty({ description: 'E.164 digits only' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;
}

export class UpdateWhatsAppBusinessProfileDto {
  @ApiProperty({ required: false, maxLength: 139 })
  @IsOptional()
  @IsString()
  about?: string;

  @ApiProperty({ required: false, maxLength: 256 })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ required: false, maxLength: 512 })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, maxLength: 128 })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiProperty({ required: false, type: [String], maxItems: 2 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(2)
  @IsString({ each: true })
  websites?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  vertical?: string;

  @ApiProperty({
    required: false,
    description: 'Base64 data URL (image/jpeg or image/png) for WhatsApp profile picture',
  })
  @IsOptional()
  @IsString()
  profilePictureBase64?: string;

  @ApiProperty({
    required: false,
    description: 'New WhatsApp display name (requires Meta approval)',
  })
  @IsOptional()
  @IsString()
  newDisplayName?: string;

  @ApiProperty({
    required: false,
    description: 'WhatsApp @username (without @ prefix)',
  })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiProperty({
    required: false,
    enum: ['none', 'force_transfer'],
    description:
      'When the username is in use on another phone in the portfolio, use force_transfer to move it',
  })
  @IsOptional()
  @IsString()
  transferAction?: 'none' | 'force_transfer';

  @ApiProperty({
    required: false,
    description: 'Remove the current business username',
  })
  @IsOptional()
  @IsBoolean()
  deleteUsername?: boolean;
}

export class SaveWhatsAppMessageConfigDto {
  @ApiProperty({ type: Object })
  config!: WhatsAppMessageConfig;
}

export class SaveWhatsAppTemplateDto {
  @ApiProperty({ description: 'Message body with Vyva variables {{customerName}}, …' })
  @IsString()
  @IsNotEmpty()
  body: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  header?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  footer?: string;

  @ApiProperty({ type: [RegisterTemplateButtonDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RegisterTemplateButtonDto)
  buttons?: RegisterTemplateButtonDto[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ required: false, enum: ['UTILITY', 'MARKETING', 'AUTHENTICATION'] })
  @IsOptional()
  @IsIn(['UTILITY', 'MARKETING', 'AUTHENTICATION'])
  metaCategory?: 'UTILITY' | 'MARKETING' | 'AUTHENTICATION';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  dateFormat?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  timeFormat?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  metaLanguage?: string;
}
