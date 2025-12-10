import { Module } from '@nestjs/common';
import { DynamooseModule } from 'nestjs-dynamoose';
import { SharedModule } from '../shared/shared.module';
import { AppointmentSchema } from 'src/app/schemas/appointment.schema';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { SalesOrderSchema } from 'src/app/schemas/sales-order.schema';
import { ProductSchema } from 'src/app/schemas/product.schema';
import { CustomerSchema } from 'src/app/schemas/customer.schema';

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
      {
        name: 'Customer',
        schema: CustomerSchema,
        options: {
          tableName: 'customers',
        },
      },
    ]),
  ],
  controllers: [AppointmentsController],
  providers: [AppointmentsService],
  exports: [AppointmentsService],
})
export class AppointmentsModule {}
