import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { User } from 'src/app/schemas/user.schema';
import { handleError } from 'src/app/shared/error.functions';

@Injectable()
export class BusinessIdGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request['user'] as User;
    try {
      if (!user.businessInfoId) {
        throw handleError('MS009');
      }
      request['businessInfoId'] = user.businessInfoId;
    } catch {
      throw handleError('MS019');
    }
    return true;
  }
}

