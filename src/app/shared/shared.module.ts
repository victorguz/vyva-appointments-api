import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DynamooseModule } from 'nestjs-dynamoose';
import { UserSchema } from '../schemas/user.schema';
import { JWT_EXPIRATION } from '../core/config/environment.config';
import { AuthGuard } from '../modules/auth/guards/auth.guard';

// Validate schema is loaded correctly
if (!UserSchema || UserSchema.constructor.name !== 'Schema') {
  throw new Error(
    'UserSchema is not a valid Dynamoose Schema instance. Check the schema file.',
  );
}

@Module({
  imports: [
    ConfigModule,
    CacheModule.register(),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: JWT_EXPIRATION,
        },
      }),
      inject: [ConfigService],
    }),
    DynamooseModule.forFeature([
      {
        name: 'User',
        schema: UserSchema,
        options: {
          tableName: 'users',
          throughput: 'ON_DEMAND',
        },
        serializers: {
          frontend: {
            include: [
              'id',
              'firstName',
              'lastName',
              'email',
              'phone',
              'createdAt',
              'role',
            ],
          },
        },
      },
    ]),
  ],
  providers: [AuthGuard],
  exports: [AuthGuard, JwtModule, DynamooseModule, ConfigModule, CacheModule],
})
export class SharedModule {}
