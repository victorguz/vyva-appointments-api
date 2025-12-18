import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';

@Injectable()
export class LambdaInvokeService {
  private lambdaClient: LambdaClient;
  private integrationsLambdaName: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';
    const stage = this.configService.get<string>('NODE_ENV') || 'qas';
    
    this.lambdaClient = new LambdaClient({ region });
    // Lambda name format: vyva-integrations-{stage}-api
    this.integrationsLambdaName = `vyva-integrations-${stage}-api`;
  }

  /**
   * Invoke integrations Lambda to create/update Google Calendar event
   */
  async invokeGoogleCalendarSync(appointment: any, action: 'create' | 'update'): Promise<void> {
    try {
      // Simulate API Gateway event structure
      const fakeApiGatewayEvent = {
        path: `/integrations/google-calendar/appointment-sync`,
        httpMethod: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          appointmentId: appointment.id,
          businessInfoId: appointment.businessInfoId,
          action, // 'create' or 'update'
          appointment: {
            id: appointment.id,
            startDate: appointment.startDate,
            endDate: appointment.endDate,
            idService: appointment.idService,
            idCustomer: appointment.idCustomer,
            idEmployee: appointment.idEmployee,
            status: appointment.status,
            businessInfoId: appointment.businessInfoId,
          },
        }),
      };

      const command = new InvokeCommand({
        FunctionName: this.integrationsLambdaName,
        InvocationType: 'Event', // Asynchronous (Fire and Forget)
        Payload: Buffer.from(JSON.stringify(fakeApiGatewayEvent)),
      });

      // Invoke lambda asynchronously - returns immediately
      await this.lambdaClient.send(command);
      
      console.log(`Google Calendar sync invoked for appointment ${appointment.id} (${action})`);
    } catch (error) {
      // Log error but don't throw - appointment creation should still succeed
      console.error('Error invoking Google Calendar sync Lambda:', error);
    }
  }
}

