import { ApiProperty } from '@nestjs/swagger';
import { WhatsAppMessage } from '../../../schemas/whatsapp-message.schema';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
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

export class SendWhatsAppTemplateDto {
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
  templateName: string;

  @ApiProperty({ example: 'es' })
  @IsString()
  @IsNotEmpty()
  languageCode: string;

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

  @ApiProperty({ description: 'Client idempotency key' })
  @IsString()
  @IsNotEmpty()
  clientMessageId: string;
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

export class VerifyRegisterDto {
  @ApiProperty({ description: 'SMS verification code or two-step PIN (6 digits)' })
  @IsString()
  @IsNotEmpty()
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code: string;
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
