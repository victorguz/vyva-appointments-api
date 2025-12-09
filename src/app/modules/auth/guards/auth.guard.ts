import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { User, UserKey } from '../../../schemas/user.schema';
import { handleError } from '../../../shared/error.functions';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    @InjectModel('User')
    private readonly userModel: Model<User, UserKey>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = this.extractTokenFromHeader(request);

    if (!token) {
      throw handleError(new Error('MS003'));
    }

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get<string>('JWT_SECRET'),
      });

      const user = await this.userModel.get({ id: payload.sub });
      if (!user) {
        throw handleError(new Error('MS007'));
      }

      request['user'] = user;
    } catch {
      throw handleError(new Error('MS003'));
    }

    return true;
  }

  private extractTokenFromHeader(request: any): string | undefined {
    const [type, token] = request.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}

