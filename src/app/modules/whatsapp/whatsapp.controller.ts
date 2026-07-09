import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
  Put,
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
  LinkWhatsAppConversationCustomerDto,
  CompleteIntegrationSetupDto,
  IntegrationSetupResultDto,
  MetaOAuthCallbackDto,
  WhatsAppMessagesPageDto,
  WhatsAppUnreadCountsDto,
  RegisterTemplatesBatchDto,
  TemplateRegistrationResultDto,
  SaveWhatsAppMessageConfigDto,
  SaveWhatsAppTemplateDto,
  SaveWhatsAppTestUserDto,
  EnsureNotificationTemplatesDto,
  UpdateWhatsAppBusinessProfileDto,
  CampaignMessageRowDto,
} from './dto/whatsapp.dto';
import {
  WhatsAppTemplateSummary,
  WhatsAppTokenDiagnostics,
  WhatsAppTestPhoneNumber,
  WhatsAppBusinessProfile,
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
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body));
    const signature = req.headers['x-hub-signature-256'] as string | undefined;

    if (!(await this.metaService.verifySignature(rawBody, signature))) {
      this.logger.warn(
        `Webhook signature rejected (rawBody=${req.rawBody ? 'present' : 'missing'})`,
      );
      res.status(HttpStatus.FORBIDDEN).json({ success: false });
      return;
    }

    try {
      await this.whatsAppService.handleWebhookPayload(body);
    } catch (err) {
      this.logger.error(
        `Webhook payload handling failed: ${(err as Error)?.message ?? err}`,
        (err as Error)?.stack,
      );
    }

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

  @Get('conversations/unread-counts')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Unread inbound WhatsApp message counts per conversation',
  })
  getUnreadCounts(
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppUnreadCountsDto>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.getUnreadCounts(idBusiness);
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

  @Patch('conversations/:idConversation/customer')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Link a WhatsApp conversation to a Vyva customer' })
  linkConversationCustomer(
    @Param('idConversation') idConversation: string,
    @Body() dto: LinkWhatsAppConversationCustomerDto,
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppConversation>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.linkConversationCustomer(
      idBusiness,
      idConversation,
      dto,
    );
  }

  @Get('campaigns/:idCampaign/messages')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'List outbound messages (with delivery state) for a campaign',
  })
  listCampaignMessages(
    @Param('idCampaign') idCampaign: string,
    @Req() req: Request,
  ): Promise<GenericResponse<CampaignMessageRowDto[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.listCampaignMessages(idBusiness, idCampaign);
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

  @Get('messages/:idMessage/media')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Resolve inbound WhatsApp message media URL (lazy upload to S3 on first access)',
  })
  getMessageMedia(
    @Param('idMessage') idMessage: string,
    @Req() req: Request,
  ): Promise<
    GenericResponse<{ url: string; mimeType: string; fileName: string }>
  > {
    const idBusiness = (req as any)['idBusiness'] as string;
    const user = (req as any)['user'] as User;
    return this.whatsAppService
      .resolveMessageMediaUrl(idBusiness, idMessage, user)
      .then((data) => new GenericResponse(data));
  }

  @Get('templates')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'List WhatsApp message templates from Meta',
  })
  listTemplates(
    @Req() req: Request,
    @Query('scope') scope?: string,
  ): Promise<GenericResponse<WhatsAppTemplateSummary[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    const approvedOnly = scope !== 'all';
    return this.whatsAppService.listTemplates(idBusiness, approvedOnly);
  }

  @Get('templates/catalog')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'List WhatsApp templates merged from domain config and Meta (read-only)',
  })
  listTemplateCatalog(@Req() req: Request) {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.listTemplateCatalog(idBusiness);
  }

  @Get('templates/:key')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Load a single template for the editor (domain + Meta, read-only)',
  })
  getTemplateEditorDetail(
    @Param('key') key: string,
    @Req() req: Request,
  ) {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.getTemplateEditorDetail(idBusiness, key);
  }

  @Put('templates/:key')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Save template to domain and register/update in Meta',
  })
  saveTemplate(
    @Param('key') key: string,
    @Body() dto: SaveWhatsAppTemplateDto,
    @Req() req: Request,
  ) {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.saveTemplate(idBusiness, key, dto);
  }

  @Get('message-config')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Load WhatsApp message templates config from domain',
  })
  getMessageConfig(@Req() req: Request) {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.getMessageConfig(idBusiness);
  }

  @Put('message-config')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Save WhatsApp message templates config' })
  saveMessageConfig(
    @Body() dto: SaveWhatsAppMessageConfigDto,
    @Req() req: Request,
  ) {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.saveMessageConfig(idBusiness, dto.config);
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
  ): Promise<
    GenericResponse<{
      phoneNumbers: WhatsAppTestPhoneNumber[];
      isSandbox: boolean;
    }>
  > {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.listTestPhoneNumbers(idBusiness);
  }

  @Get('integration/test-users')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'List phone numbers previously used for WhatsApp test messages',
  })
  getTestUsers(@Req() req: Request): Promise<GenericResponse<string[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.getTestUsers(idBusiness);
  }

  @Post('integration/test-users')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Save a phone number used for WhatsApp test messages',
  })
  addTestUser(
    @Body() dto: SaveWhatsAppTestUserDto,
    @Req() req: Request,
  ): Promise<GenericResponse<string[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.addTestUser(idBusiness, dto.phoneNumber);
  }

  @Post('integration/confirm-payment-method')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Persist onboarding confirmation that Meta Business payment method was registered',
  })
  confirmMetaPaymentMethod(
    @Req() req: Request,
  ): Promise<GenericResponse<{ metaPaymentMethodConfirmed: boolean }>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.confirmMetaPaymentMethod(idBusiness);
  }

  @Post('integration/ensure-notification-templates')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Register WhatsApp notification templates in Meta when toggles are enabled',
  })
  ensureNotificationTemplates(
    @Body() dto: EnsureNotificationTemplatesDto,
    @Req() req: Request,
  ) {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.ensureNotificationTemplates(idBusiness, dto);
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
  ): Promise<
    GenericResponse<{
      phoneNumberId: string;
      wabaId: string;
      registered: boolean;
      registrationError?: string;
    }>
  > {
    const idBusiness = (req as any)['idBusiness'] as string;
    const user = (req as any)['user'] as User;
    return this.whatsAppService.handleMetaOAuthCallback(
      idBusiness,
      user.id,
      dto.code,
      dto.redirectUri,
    );
  }

  @Post('integration/complete-setup')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Register the phone on Cloud API and default appointment templates in Meta (sequential, idempotent)',
  })
  completeIntegrationSetup(
    @Body() dto: CompleteIntegrationSetupDto,
    @Req() req: Request,
  ): Promise<GenericResponse<IntegrationSetupResultDto>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.completeIntegrationSetup(
      idBusiness,
      dto.useSystemUserToken,
    );
  }

  @Get('integration/business-profile')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Get WhatsApp Business profile for the connected phone number',
  })
  getBusinessProfile(
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppBusinessProfile>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.getBusinessProfile(idBusiness);
  }

  @Put('integration/business-profile')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Update WhatsApp Business profile for the connected phone number',
  })
  updateBusinessProfile(
    @Body() dto: UpdateWhatsAppBusinessProfileDto,
    @Req() req: Request,
  ): Promise<GenericResponse<WhatsAppBusinessProfile>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.updateBusinessProfile(idBusiness, dto);
  }

  @Get('integration/business-profile/username-suggestions')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary: 'Get reserved WhatsApp business username suggestions from Meta',
  })
  getBusinessUsernameSuggestions(
    @Req() req: Request,
  ): Promise<GenericResponse<string[]>> {
    const idBusiness = (req as any)['idBusiness'] as string;
    return this.whatsAppService.getBusinessUsernameSuggestions(idBusiness);
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
