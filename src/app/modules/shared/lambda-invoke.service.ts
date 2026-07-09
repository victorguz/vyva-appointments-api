import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import * as jwt from 'jsonwebtoken';
import { User } from 'src/app/schemas/user.schema';

@Injectable()
export class LambdaInvokeService {
  private lambdaClient: LambdaClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';

    this.lambdaClient = new LambdaClient({ region });
  }

  private signUserToken(user: User): string {
    const secret = this.configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET not configured');
    }
    return jwt.sign(
      {
        sub: user.id,
        email: user.email,
        role: (user as any).role,
        idBusiness: user.idBusiness,
      },
      secret,
      { expiresIn: '1h' },
    );
  }

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
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const bearer = this.signUserToken(user);

      const event = {
        httpMethod: method,
        path: normalizedPath,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${bearer}`,
        },
        multiValueHeaders: {} as Record<string, string[]>,
        queryStringParameters: null as null,
        multiValueQueryStringParameters: null as null,
        pathParameters: null as null,
        stageVariables: null as null,
        requestContext: {
          stage,
          path: normalizedPath,
          httpMethod: method,
        },
        resource: normalizedPath,
        isBase64Encoded: false,
        body: body ? JSON.stringify(body) : undefined,
      };

      const command = new InvokeCommand({
        FunctionName: fullLambdaName,
        InvocationType: 'RequestResponse',
        Payload: Buffer.from(JSON.stringify(event)),
      });

      const response = await this.lambdaClient.send(command);

      if (response.Payload) {
        const payload = JSON.parse(Buffer.from(response.Payload).toString());

        if (payload.errorMessage) {
          throw new Error(payload.errorMessage);
        }

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
