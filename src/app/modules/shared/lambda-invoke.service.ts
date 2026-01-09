import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { User } from 'src/app/schemas/user.schema';
import * as jwt from 'jsonwebtoken';

@Injectable()
export class LambdaInvokeService {
  private lambdaClient: LambdaClient;
  private integrationsLambdaName: string;
  private jwtSecret: string;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';
    const stage = this.configService.get<string>('NODE_ENV') || 'qas';

    this.lambdaClient = new LambdaClient({ region });
    // Lambda name format: vyva-integrations-{stage}-api
    this.integrationsLambdaName = `vyva-integrations-${stage}-api`;
    this.jwtSecret = this.configService.get<string>('JWT_SECRET') || '';
  }

  /**
   * Invoke integrations Lambda to create/update Google Calendar event
   */
  async invokeGoogleCalendarSync(
    appointment: any,
    action: 'create' | 'update',
  ): Promise<void> {
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
          idBusiness: appointment.idBusiness,
          action, // 'create' or 'update'
          appointment: {
            id: appointment.id,
            startDate: appointment.startDate,
            endDate: appointment.endDate,
            idService: appointment.idService,
            idCustomer: appointment.idCustomer,
            idEmployee: appointment.idEmployee,
            status: appointment.status,
            idBusiness: appointment.idBusiness,
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

      console.log(
        `Google Calendar sync invoked for appointment ${appointment.id} (${action})`,
      );
    } catch (error) {
      // Log error but don't throw - appointment creation should still succeed
      console.error('Error invoking Google Calendar sync Lambda:', error);
    }
  }

  /**
   * Invoke a Lambda function with HTTP method, path, and body
   * @param lambdaName Lambda function name (without stage suffix)
   * @param method HTTP method (GET, POST, PUT, etc.)
   * @param path API path
   * @param body Request body
   * @param user User object for JWT token generation
   * @returns Promise with Lambda response
   */
  async invokeFunction(
    lambdaName: string,
    method: string,
    path: string,
    body: any,
    user: User,
  ): Promise<any> {
    try {
      const stage = this.configService.get<string>('NODE_ENV') || 'qas';
      const fullLambdaName = `${lambdaName}-${stage}-api`;

      // Generate JWT token for the user
      const token = jwt.sign(
        {
          id: user.id,
          idBusiness: user.idBusiness,
          email: user.email,
        },
        this.jwtSecret,
        { expiresIn: '1h' },
      );

      // Simulate API Gateway event structure
      const apiGatewayEvent = {
        path: path.startsWith('/') ? path : `/${path}`,
        httpMethod: method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
        requestContext: {
          authorizer: {
            principalId: user.id,
          },
        },
      };

      const command = new InvokeCommand({
        FunctionName: fullLambdaName,
        InvocationType: 'RequestResponse', // Synchronous
        Payload: Buffer.from(JSON.stringify(apiGatewayEvent)),
      });

      const response = await this.lambdaClient.send(command);

      if (response.Payload) {
        const payload = JSON.parse(Buffer.from(response.Payload).toString());
        
        // Handle Lambda error response
        if (payload.errorMessage) {
          throw new Error(payload.errorMessage);
        }

        // Parse the response body if it exists
        if (payload.body) {
          return JSON.parse(payload.body);
        }

        return payload;
      }

      return null;
    } catch (error) {
      console.error(`Error invoking Lambda function ${lambdaName}:`, error);
      throw error;
    }
  }
}
