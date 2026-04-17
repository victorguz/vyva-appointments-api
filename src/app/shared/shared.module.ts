import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DynamooseModule } from 'nestjs-dynamoose';
import { UserSchema } from '../schemas/user.schema';
import { BusinessSchema } from '../schemas/business.schema';
import { AuthGuard } from '../core/auth/guards/auth.guard';

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
      {
        name: 'Business',
        schema: BusinessSchema,
        options: {
          tableName: 'businesses',
          throughput: 'ON_DEMAND',
        },
      },
    ]),
  ],
  providers: [AuthGuard],
  exports: [AuthGuard, DynamooseModule, ConfigModule, CacheModule],
})
export class SharedModule {}
