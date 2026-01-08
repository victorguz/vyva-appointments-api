import { Module } from '@nestjs/common';
import { DynamooseModule } from 'nestjs-dynamoose';
import { AppointmentSchema } from 'src/app/schemas/appointment.schema';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ProductSchema } from 'src/app/schemas/product.schema';
import { UserSchema } from 'src/app/schemas/user.schema';
import { UsersService } from '../users/users.service';
import { TimeslotsController } from './timeslots/timeslots.controller';
import { TimeslotsService } from './timeslots/timeslots.service';
import { BusinessSchema } from 'src/app/schemas/business.schema';
import { AppointmentsCustomerService } from './appointments-customer.service';
import { AppointmentsPublicService } from './appointments-public.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { JWT_EXPIRATION } from 'src/app/core/config/environment.config';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';

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
        name: 'Appointment',
        schema: AppointmentSchema,
        options: {
          tableName: 'appointments',
          throughput: 'ON_DEMAND',
        },
      },
      {
        name: 'User',
        schema: UserSchema,
        options: {
          tableName: 'users',
          throughput: 'ON_DEMAND',
          create: false,
        },
      },
      {
        name: 'Business',
        schema: BusinessSchema,
        options: {
          tableName: 'businesses',
          throughput: 'ON_DEMAND',
          create: false,
        },
      },
      {
        name: 'Product',
        schema: ProductSchema,
        options: {
          tableName: 'products',
          throughput: 'ON_DEMAND',
          create: false,
        },
      },
    ]),
  ],
  controllers: [AppointmentsController, TimeslotsController],
  providers: [
    AppointmentsService,
    UsersService,
    TimeslotsService,
    AppointmentsCustomerService,
    AppointmentsPublicService,
    LambdaInvokeService,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
