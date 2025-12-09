import { Injectable } from '@nestjs/common';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import { AppointmentStatus } from 'src/app/core/constants/domain.constants';
import { SalesOrder, SalesOrderKey } from 'src/app/schemas/sales-order.schema';
import { User } from 'src/app/schemas/user.schema';
import { v4 as uuidv4 } from 'uuid';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { handleError } from '../../shared/error.functions';
import { deleteEmptyProperties } from '../../shared/shared.functions';
import {
  CreateAppointmentDto,
  ListAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';

@Injectable()
export class AppointmentsService extends TransactionSupport {
  constructor(
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
    @InjectModel('SalesOrder')
    private readonly salesOrderModel: Model<SalesOrder, SalesOrderKey>,
    @InjectModel('Product')
    private readonly productModel: Model<any, any>,
    @InjectModel('Customer')
    private readonly customerModel: Model<any, any>,
    @InjectModel('User')
    private readonly userModel: Model<any, any>,
  ) {
    super();
  }

  private generateOrderNumber(): string {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 7);
    return `ORD-${timestamp}-${random}`.toUpperCase();
  }

  async create(
    body: CreateAppointmentDto,
    user: User,
  ): Promise<GenericResponse<Appointment>> {
    try {
      const transactions = [];
      
      // Crear orden de venta simplificada
      const orderNumber = this.generateOrderNumber();
      const paidAmount = body.paymentMethods?.reduce((sum, pm) => sum + (pm.amount || 0), 0) || 0;
      
      const salesOrder: SalesOrder = {
        id: uuidv4(),
        orderNumber,
        idCustomer: body.idCustomer,
        products: [{ id: body.idService, quantity: 1, isService: true, price: 0 }],
        paymentMethods: body.paymentMethods || [],
        paidAmount,
        totalAmount: 0,
        status: paidAmount === 0 ? 'pending' : 'paid',
        businessInfoId: user.businessInfoId,
      } as any;

      const salesTransaction =
        this.salesOrderModel.transaction.create(salesOrder);
      transactions.push(salesTransaction);

      let appointment = null;
      if (body.startDate && body.endDate) {
        this.validateAppointmentDates(body.startDate, body.endDate);

        appointment = {
          id: uuidv4(),
          startDate: new Date(body.startDate).getTime() as any,
          endDate: new Date(body.endDate).getTime() as any,
          idService: body.idService,
          idCustomer: body.idCustomer,
          idEmployee: body.idEmployee,
          idOrder: salesOrder.id,
          status: AppointmentStatus.pending,
          businessInfoId: user.businessInfoId,
          createdBy: user.id,
        };

        const cleanedPayload = deleteEmptyProperties(appointment);

        const appointmentTransaction = this.model.transaction.create(cleanedPayload);

        transactions.push(appointmentTransaction);
      }

      await this.transaction([...transactions]);

      const appointmentResult = await this.model.get({ id: appointment.id });

      return new GenericResponse(appointmentResult);
    } catch (error) {
      throw handleError(error);
    }
  }

  async findAll(
    user: User,
    filters?: ListAppointmentDto,
  ): Promise<GenericResponse<Appointment[]>> {
    try {
      // Validate user and businessInfoId
      if (!user || !user.businessInfoId) {
        throw new Error('MS014');
      }

      let query = this.model.scan();

      // Apply filters
      if (filters?.idCustomer) {
        query = query.where('idCustomer').eq(filters.idCustomer);
      }

      if (filters?.idEmployee) {
        query = query.where('idEmployee').eq(filters.idEmployee);
      }

      // if (filters?.idService) {
      //   query = query.where('idService').eq(filters.idService);
      // }

      if (filters?.idOrder) {
        query = query.where('idOrder').eq(filters.idOrder);
      }

      if (filters?.status) {
        query = query.where('status').eq(filters.status);
      }

      // Always filter by business
      query = query.where('businessInfoId').eq(user.businessInfoId);

      // Apply date range filters
      if (filters?.startDate) {
        query = query.where('startDate').ge(new Date(filters.startDate) as any);
      }

      if (filters?.endDate) {
        query = query.where('endDate').le(new Date(filters.endDate) as any);
      }

      const appointments = (await query.exec()).map(
        (appointment) => appointment as Appointment,
      );
      return new GenericResponse(appointments);
    } catch (error) {
      throw handleError(error);
    }
  }

  async update(
    id: string,
    updateAppointmentDto: UpdateAppointmentDto,
    user: User,
  ): Promise<GenericResponse<Appointment>> {
    try {
      // Validate id
      if (!id) {
        throw new Error('MS014');
      }

      const appointmentResult = await this.model
        .scan()
        .where('id')
        .eq(id)
        .where('businessInfoId')
        .eq(user.businessInfoId)
        .exec();

      if (!appointmentResult || appointmentResult.length === 0) {
        throw new Error('MS007');
      }

      const appointment = appointmentResult[0] as Appointment;
      const transactions: any[] = [];

      // Separate paymentMethods from other fields
      const cleanedUpdateDto = deleteEmptyProperties(updateAppointmentDto);
      const { paymentMethods, ...cleanedDto } = cleanedUpdateDto as any;

      // Handle date conversions and validation
      if (cleanedDto.startDate) {
        cleanedDto.startDate = new Date(cleanedDto.startDate) as any;
      }
      if (cleanedDto.endDate) {
        cleanedDto.endDate = new Date(cleanedDto.endDate) as any;
      }

      // Validate dates if both are provided
      if (cleanedDto.startDate && cleanedDto.endDate) {
        this.validateAppointmentDates(
          cleanedDto.startDate.toString(),
          cleanedDto.endDate.toString(),
        );
      }

      // Handle payment methods update if provided
      if (paymentMethods && paymentMethods.length > 0) {
        let orderId = appointment.idOrder;

        if (!orderId) {
          // Create new order if none exists
          const orderNumber = this.generateOrderNumber();
          const paidAmount = paymentMethods.reduce((sum: number, pm: any) => sum + (pm.amount || 0), 0);
          
          const newOrder: SalesOrder = {
            id: uuidv4(),
            orderNumber,
            idCustomer: appointment.idCustomer || '',
            products: [{ id: appointment.idService, quantity: 1, isService: true, price: 0 }],
            paymentMethods: paymentMethods,
            paidAmount,
            totalAmount: 0,
            status: paidAmount === 0 ? 'pending' : 'paid',
            businessInfoId: user.businessInfoId,
          } as any;

          const orderCreateTx =
            this.salesOrderModel.transaction.create(newOrder);
          transactions.push(orderCreateTx);

          // Update appointment with new order ID
          cleanedDto.idOrder = newOrder.id;
        } else {
          // Update existing order - only update payment-related fields
          const existingOrder = await this.salesOrderModel.get({
            id: orderId,
          });
          if (!existingOrder) {
            throw new Error('MS007');
          }

          const orderData = existingOrder.toJSON() as SalesOrder;

          // Calculate new values based on payment methods
          const paidAmount = this.calculatePaidAmount(paymentMethods);
          const totalAmount = orderData.totalAmount || 0;
          const orderStatus =
            paidAmount === 0
              ? 'pending'
              : paidAmount === totalAmount
              ? 'paid'
              : 'partiallyPaid';

          // Only update payment-related fields, keep existing id, orderNumber, products, etc.
          const orderUpdateTx = this.salesOrderModel.transaction.update(
            { id: orderId },
            {
              paymentMethods: paymentMethods,
              paidAmount: paidAmount,
              status: orderStatus,
              modifiedBy: user.id,
            } as any,
          );
          transactions.push(orderUpdateTx);
        }
      }

      // Update appointment fields if there are any changes
      if (Object.keys(cleanedDto).length > 0) {
        const appointmentUpdateTx = this.model.transaction.update(
          { id: appointment.id },
          { ...cleanedDto, modifiedBy: user.id },
        );
        transactions.push(appointmentUpdateTx);
      }

      // Execute transaction if there are any operations
      if (transactions.length > 0) {
        await this.transaction(transactions);
      }

      // Return updated appointment
      const updatedAppointment = await this.model.get({ id: appointment.id });

      if (!updatedAppointment) {
        throw new Error('MS007');
      }

      return new GenericResponse(updatedAppointment as Appointment);
    } catch (error) {
      throw handleError(error);
    }
  }

  async updateStatus(
    id: string,
    updateStatusDto: UpdateAppointmentStatusDto,
  ): Promise<GenericResponse<Appointment>> {
    try {
      // Validate id and status
      if (!id) {
        throw new Error('MS014');
      }
      if (!updateStatusDto.status) {
        throw new Error('MS014');
      }

      const updateData: any = { status: updateStatusDto.status };

      if (updateStatusDto.modifiedBy) {
        updateData.modifiedBy = updateStatusDto.modifiedBy;
      }

      await this.model.update({ id }, updateData);
      const updatedAppointment = await this.model.get({ id });

      if (!updatedAppointment) {
        throw new Error('MS007');
      }

      return new GenericResponse(updatedAppointment as Appointment);
    } catch (error) {
      throw handleError(error);
    }
  }

  async remove(id: string): Promise<GenericResponse<boolean>> {
    try {
      // Validate id
      if (!id) {
        throw new Error('id is required and cannot be undefined or null');
      }

      await this.model.delete({ id });
      return new GenericResponse(true);
    } catch (error) {
      throw handleError(error);
    }
  }

  private validateAppointmentDates(startDate: string, endDate: string): void {
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('MS042');
    }

    if (start >= end) {
      throw new Error('MS041');
    }
  }

  private calculatePaidAmount(
    paymentMethods: Array<{ value: number }>,
  ): number {
    return (paymentMethods || []).reduce(
      (acc, item) => acc + (item?.value || 0),
      0,
    );
  }
}
