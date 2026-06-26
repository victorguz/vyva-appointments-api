import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { InjectModel } from 'nestjs-dynamoose';
import { Model } from 'nestjs-dynamoose';
import { User, UserKey } from 'src/app/schemas/user.schema';
import { UserRole } from 'src/app/core/constants/domain.constants';
import {
  EdgeUserContext,
  extractEdgeUserContext,
} from '../utils/edge-user-context.util';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @InjectModel('User')
    private readonly model: Model<User, UserKey>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const edgeUser = extractEdgeUserContext(request);

    if (!edgeUser?.sub) {
      throw new Error('MS019');
    }

    return this.attachUserToRequest(request, edgeUser);
  }

  private async attachUserToRequest(
    request: Request,
    edgeUser: EdgeUserContext,
  ): Promise<boolean> {
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
  }
}
