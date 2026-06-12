import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { AuthGuard } from '../../core/auth/guards/auth.guard';
import { BusinessIdGuard } from '../../core/auth/guards/businessId.guard';
import { WhatsAppConversation } from '../../schemas/whatsapp-conversation.schema';
import { WhatsAppMessage } from '../../schemas/whatsapp-message.schema';
import {
  SendWhatsAppMessageDto,
  SendWhatsAppTemplateDto,
  ListMessagesQueryDto,
  VerifyRegisterDto,
  MetaOAuthCallbackDto,
  WhatsAppMessagesPageDto,
  RegisterTemplatesBatchDto,
  TemplateRegistrationResultDto,
} from './dto/whatsapp.dto';
import {
  WhatsAppTemplateSummary,
  WhatsAppTokenDiagnostics,
  WhatsAppTestPhoneNumber,
} from './whatsapp-meta.service';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppMetaService } from './whatsapp-meta.service';
import { IntegrationsCredentialsService } from './integrations-credentials.service';
import { User } from '../../schemas/user.schema';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly metaService: WhatsAppMetaService,
    private readonly credentialsService: IntegrationsCredentialsService,
  ) {}

  @Get('webhook')
  @ApiOperation({ summary: 'Meta webhook verification' })
  async verifyWebhook(@Req() req: Request, @Res() res: Response): Promise<void> {
    const mode = readWebhookQueryParam(req.query, 'hub.mode', 'hub_mode');
    const token = readWebhookQueryParam(
      req.query,
      'hub.verify_token',
      'hub_verify_token',
    );
    const challenge = readWebhookQueryParam(
      req.query,
      'hub.challenge',
      'hub_challenge',
    );

    try {
      const result = await this.whatsAppService.verifyWebhookToken(
        mode,
        token,
        challenge,
      );
      if (result === null) {
        res.status(HttpStatus.FORBIDDEN).send('Forbidden');
        return;
      }
      res.status(HttpStatus.OK).send(result);
    } catch (err) {
      this.logger.error(
        `Webhook verification failed: ${(err as Error)?.message ?? err}`,
        (err as Error)?.stack,
      );
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).send('Internal Server Error');
    }
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Meta webhook events' })
  async receiveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Res() res: Response,
  ): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const rawBody = req.rawBody ?? JSON.stringify(body);
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!(await this.metaService.verifySignature(rawBody, signature))) {
      res.status(HttpStatus.FORBIDDEN).json({ success: false });
      return;
    }

    await this.whatsAppService.handleWebhookPayload(body);
    res.status(HttpStatus.OK).json({ success: true });
  }

  @Get('conversations')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'List WhatsApp conversations for business' })
  listConversations(
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppConversation[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.listConversations(idBusiness);
  }

  @Get('conversations/:idConversation/messages')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'List messages in a conversation' })
  listMessages(
    @Param('idConversation') idConversation: string,
    @Query() query: ListMessagesQueryDto,
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppMessagesPageDto>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.listMessages(idBusiness, idConversation, query);
  }

  @Post('conversations/:idConversation/read')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mark inbound messages as read in Meta when the agent opens the conversation',
  })
  markConversationRead(
    @Param('idConversation') idConversation: string,
    @Req() req: Request,
  ): Promise<GenericResponse<{ marked: number }>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.markConversationAsRead(
      idBusiness,
      idConversation,
    );
  }

  @Post('messages')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Send a WhatsApp text message' })
  sendMessage(
    @Body() dto: SendWhatsAppMessageDto,
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppMessage>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.sendMessage(idBusiness, dto);
  }

  @Get('templates')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'List approved WhatsApp message templates from Meta',
  })
  listTemplates(
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppTemplateSummary[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.listTemplates(idBusiness);
  }

  @Post('templates/register')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Register message templates with Meta (batch)' })
  registerTemplates(
    @Body() dto: RegisterTemplatesBatchDto,
    @Req() req: Request,
  ): Promise<GenericResponse<TemplateRegistrationResultDto[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.registerTemplates(idBusiness, dto);
  }

  @Post('messages/template')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Send an approved WhatsApp template message' })
  sendTemplate(
    @Body() dto: SendWhatsAppTemplateDto,
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppMessage>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.sendTemplate(idBusiness, dto);
  }

  @Get('integration/status')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Whether WhatsApp credentials are configured' })
  async integrationStatus(
    @Req() req: Request,
  ): Promise<GenericResponse<{ configured: boolean }>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    const creds = await this.credentialsService.getByBusinessId(idBusiness);
    return new GenericResponse({
      configured: this.credentialsService.isConfigured(creds),
    });
  }

  @Get('integration/diagnostics')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Validate WhatsApp credentials against Meta (token, WABA, phone ID)',
  })
  diagnoseIntegration(
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppTokenDiagnostics>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.diagnoseIntegration(idBusiness);
  }

  @Get('integration/test-numbers')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'List test/sandbox phone numbers registered in Meta for this account',
  })
  listTestPhoneNumbers(
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppTestPhoneNumber[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.listTestPhoneNumbers(idBusiness);
  }

  @Post('integration/meta-oauth-callback')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Exchange Meta OAuth code from Embedded Signup and store WhatsApp credentials',
  })
  metaOAuthCallback(
    @Body() dto: MetaOAuthCallbackDto,
    @Req() req: Request,
  ): Promise<GenericResponse<{ phoneNumberId: string; wabaId: string }>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    const user = (req as any)['user'] as User;
    return this.whatsAppService.handleMetaOAuthCallback(
      idBusiness,
      user.id,
      dto.code,
      dto.redirectUri,
    );
  }

  @Post('integration/request-code')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Save credentials then request Meta SMS verification code',
  })
  requestIntegrationCode(@Req() req: Request): Promise<
    GenericResponse<{
      codeSent: boolean;
      alreadyVerified?: boolean;
    }>
  > {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.requestIntegrationCode(idBusiness);
  }

  @Post('integration/verify-register')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Verify SMS code and register phone number for Cloud API',
  })
  verifyAndRegister(
    @Body() dto: VerifyRegisterDto,
    @Req() req: Request,
  ): Promise<GenericResponse<{ registered: boolean }>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.verifyAndRegisterPhone(idBusiness, dto.code);
  }
}

function readWebhookQueryParam(
  query: Request['query'],
  dottedKey: string,
  underscoredKey: string,
): string {
  for (const key of [dottedKey, underscoredKey]) {
    const raw = query[key];
    if (typeof raw === 'string' && raw.trim()) {
      return raw.trim();
    }
    if (Array.isArray(raw) && typeof raw[0] === 'string' && raw[0].trim()) {
      return raw[0].trim();
    }
  }

  const nested = query[dottedKey.split('.')[0]];
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const nestedValue = (nested as Record<string, unknown>)[
      dottedKey.split('.')[1]
    ];
    if (typeof nestedValue === 'string' && nestedValue.trim()) {
      return nestedValue.trim();
    }
  }

  return '';
}
