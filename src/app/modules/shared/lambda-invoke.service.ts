import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { User } from 'src/app/schemas/user.schema';

@Injectable()
export class LambdaInvokeService {
  private lambdaClient: LambdaClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';

    this.lambdaClient = new LambdaClient({ region });
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

      const edgeUserContext = JSON.stringify({
        sub: user.id,
        idBusiness: user.idBusiness,
        role: (user as any).role,
        email: user.email,
        authType: 'jwt',
      });

      const event = {
        httpMethod: method,
        path: path.startsWith('/') ? path : `/${path}`,
        headers: {
          'Content-Type': 'application/json',
          'x-vyva-user': edgeUserContext,
        },
        multiValueHeaders: {} as Record<string, string[]>,
        queryStringParameters: {} as Record<string, string>,
        multiValueQueryStringParameters: null as null,
        pathParameters: null as null,
        stageVariables: null as null,
        requestContext: {} as any,
        resource: '',
        isBase64Encoded: false,
        body: JSON.stringify(body),
      };

      const command = new InvokeCommand({
        FunctionName: fullLambdaName,
        InvocationType: 'RequestResponse', // Synchronous
        Payload: Buffer.from(JSON.stringify(event)),
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
