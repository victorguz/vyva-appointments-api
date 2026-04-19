import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { handleError } from 'src/app/shared/error.functions';
import { InjectModel } from 'nestjs-dynamoose';
import { Model } from 'nestjs-dynamoose';
import { User, UserKey } from 'src/app/schemas/user.schema';
import { UserRole } from 'src/app/core/constants/domain.constants';

interface EdgeUserContext {
  sub: string;
  idBusiness?: string;
  role?: string;
  email?: string;
  authType?: 'jwt' | 'apiKey';
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @InjectModel('User')
    private readonly model: Model<User, UserKey>,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const edgeUser = this.extractEdgeUserFromHeader(request);

    if (!edgeUser || !edgeUser.sub) {
      throw handleError('MS019');
    }

    try {
      const user = await this.model.get({ id: edgeUser.sub });
      if (!user) {
        throw new Error('MS019');
      }

      const userData = user.toJSON() as User;
      userData.password = undefined;

      if (
        userData.role === UserRole.superadmin &&
        edgeUser.idBusiness &&
        edgeUser.idBusiness.trim() !== ''
      ) {
        userData.idBusiness = edgeUser.idBusiness;
      }

      (request as any)['user'] = userData;
      return true;
    } catch (error) {
      throw handleError(error);
    }
  }

  private extractEdgeUserFromHeader(
    request: Request,
  ): EdgeUserContext | undefined {
    const rawHeader = request.headers['x-vyva-user'];
    const rawValue =
      typeof rawHeader === 'string'
        ? rawHeader
        : Array.isArray(rawHeader)
          ? rawHeader[0]
          : undefined;

    if (!rawValue) {
      return undefined;
    }

    try {
      const parsed = JSON.parse(rawValue) as EdgeUserContext;
      if (!parsed || typeof parsed !== 'object') {
        return undefined;
      }
      return parsed;
    } catch {
      return undefined;
    }
  }
}
