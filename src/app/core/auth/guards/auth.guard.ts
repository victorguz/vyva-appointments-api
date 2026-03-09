import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { handleError } from 'src/app/shared/error.functions';
import { InjectModel } from 'nestjs-dynamoose';
import { Model } from 'nestjs-dynamoose';
import { User, UserKey } from 'src/app/schemas/user.schema';
import { Business, BusinessKey } from '../../../schemas/business.schema';
import { UserRole } from 'src/app/core/constants/domain.constants';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    @InjectModel('User')
    private readonly model: Model<User, UserKey>,
    @InjectModel('Business')
    private readonly businessModel: Model<Business, BusinessKey>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKeyFromHeader(request);
    const token = this.extractTokenFromHeader(request);

    if (apiKey) {
      return this.authenticateByApiKey(request, apiKey);
    }
    if (token) {
      return this.authenticateByToken(request, token);
    }

    throw handleError('MS019');
  }

  private async authenticateByApiKey(
    request: Request,
    apiKey: string,
  ): Promise<boolean> {
    try {
      const users = await this.model
        .scan()
        .where('apiKey')
        .eq(apiKey)
        .where('status')
        .eq(true)
        .exec();

      if (!users || users.length === 0) {
        throw new Error('MS007');
      }

      const userData = users[0].toJSON() as User;

      if (
        ![UserRole.admin, UserRole.superadmin].includes(
          userData.role as UserRole,
        )
      ) {
        throw new Error('MS019');
      }

      // Solo exige idBusiness si no es superadmin (superadmin puede no enviar api-bid)
      if (!userData.idBusiness && userData.role !== UserRole.superadmin) {
        throw new Error('MS019');
      }

      const cleanUserData: User = {
        ...userData,
        password: undefined,
        apiKey: undefined,
      };

      return this.authorizeAdminOrSuperadmin(request, cleanUserData);
    } catch (error) {
      throw handleError(error);
    }
  }

  private async authorizeAdminOrSuperadmin(
    request: Request,
    userData: Partial<User>,
  ): Promise<boolean> {
    if (userData.role === UserRole.superadmin) {
      const bid = this.extractApiBidFromHeader(request);
      if (bid) {
        const business = await this.businessModel.get({ id: bid });
        if (!business) {
          throw new Error('MS007'); // business not found
        }
        userData.idBusiness = bid;
      } else {
        userData.idBusiness = undefined;
        delete userData.idBusiness;
      }
    }

    (request as any)['user'] = userData;
    return true;
  }

  private extractApiBidFromHeader(request: Request): string | undefined {
    return (
      (request.headers['x-api-bid'] as string | undefined) ||
      (request.headers['api-bid'] as string | undefined)
    );
  }

  private async authenticateByToken(
    request: Request,
    token: string,
  ): Promise<boolean> {
    try {
      const payload: any = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      const user = await this.model.get({ id: payload.sub });
      // const user = await this.model.get({
      //   id: 'c8133285-9e16-4379-91b6-dbd8596effaa',
      // });
      if (!user) {
        throw new Error('MS019');
      }
      const userData = user.toJSON() as User;
      userData.password = undefined;
      (request as any)['user'] = userData;
      return true;
    } catch {
      throw handleError('MS019');
    }
  }

  private extractApiKeyFromHeader(request: Request): string | undefined {
    return (
      (request.headers['x-api-key'] as string | undefined) ||
      (request.headers['api-key'] as string | undefined) ||
      (request.headers['x-apikey'] as string | undefined)
    );
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
