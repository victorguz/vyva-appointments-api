import { Module } from '@nestjs/common';
import { DynamooseModule } from 'nestjs-dynamoose';
import { SharedModule } from '../shared/shared.module';
import { AppointmentSchema } from 'src/app/schemas/appointment.schema';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { ProductSchema } from 'src/app/schemas/product.schema';
import { CustomerSchema } from 'src/app/schemas/customer.schema';
import { UserSchema } from 'src/app/schemas/user.schema';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { TimeslotsController } from './timeslots/timeslots.controller';
import { TimeslotsService } from './timeslots/timeslots.service';

@Module({
  imports: [
    SharedModule,
    DynamooseModule.forFeature([
      {
        name: 'Appointment',
        schema: AppointmentSchema,
        options: {
          tableName: 'appointments',
        },
      },
      {
        name: 'Product',
        schema: ProductSchema,
        options: {
          tableName: 'products',
        },
      },
      {
        name: 'Customer',
        schema: CustomerSchema,
        options: {
          tableName: 'customers',
        },
      },
      {
        name: 'User',
        schema: UserSchema,
        options: {
          tableName: 'users',
        },
      },
    ]),
  ],
  controllers: [AppointmentsController, TimeslotsController],
  providers: [
    AppointmentsService,
    CustomersService,
    ProductsService,
    UsersService,
    TimeslotsService,
  ],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
