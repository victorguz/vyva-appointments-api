import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common';
import { User } from 'src/app/schemas/user.schema';
@Injectable()
export class BusinessIdGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request['user'] as User;
    try {
      if (!user.idBusiness) {
        throw new Error('MS019');
      }
      request['idBusiness'] = user.idBusiness;
    } catch {
      throw new Error('MS019');
    }
    return true;
  }
}
