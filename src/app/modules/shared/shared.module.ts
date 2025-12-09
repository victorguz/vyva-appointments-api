import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppointmentSchema } from 'src/app/schemas/appointment.schema';
import { ProductSchema } from 'src/app/schemas/product.schema';
import { SalesOrderSchema } from 'src/app/schemas/sales-order.schema';

import { JWT_EXPIRATION } from '../../core/config/environment.config';
import { CustomerSchema } from '../../schemas/customer.schema';
import { UserSchema } from '../../schemas/user.schema';
import { AuthGuard } from '../auth/guards/auth.guard';

@Module({
  imports: [
    ConfigModule,
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
            ],
          },
        },
      },
      {
        name: 'Customer',
        schema: CustomerSchema,
        options: {
          tableName: 'customers',
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
            ],
          },
        },
      },

      {
        name: 'Appointment',
        schema: AppointmentSchema,
        options: {
          tableName: 'appointments',
        },
      },
      {
        name: 'SalesOrder',
        schema: SalesOrderSchema,
        options: {
          tableName: 'sales-orders',
        },
      },
      {
        name: 'Product',
        schema: ProductSchema,
        options: {
          tableName: 'products',
        },
      },
    ]),
  ],
  providers: [AuthGuard],
  exports: [AuthGuard, JwtModule, DynamooseModule],
})
export class SharedModule {}
