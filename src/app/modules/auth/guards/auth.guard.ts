import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthUser } from '../dtos/auth.dto';
import { handleError } from 'src/app/shared/error.functions';
import { InjectModel } from 'nestjs-dynamoose';
import { Model } from 'nestjs-dynamoose';
import { User, UserKey } from 'src/app/schemas/user.schema';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    @InjectModel('User')
    private readonly model: Model<User, UserKey>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);
    if (!token) {
      throw handleError('MS019');
    }
    try {
      const payload: AuthUser = await this.jwtService.verifyAsync(token, {
        secret: process.env.JWT_SECRET,
      });
      const user = await this.model.get({ id: payload.sub });
      if (!user) {
        throw handleError('MS019');
      }
      const userData = user.toJSON() as User;
      userData.password = undefined;
      request['user'] = userData;
    } catch {
      throw handleError('MS019');
    }
    return true;
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
