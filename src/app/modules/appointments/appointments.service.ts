import { Injectable } from '@nestjs/common';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import { AppointmentStatus } from 'src/app/core/constants/domain.constants';
import { Customer, CustomerKey } from 'src/app/schemas/customer.schema';
import { Product, ProductKey } from 'src/app/schemas/product.schema';
import { User } from 'src/app/schemas/user.schema';
import { v4 as uuidv4 } from 'uuid';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { handleError } from '../../shared/error.functions';
import { deleteEmptyProperties } from '../../shared/shared.functions';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';
import { UsersService } from '../users/users.service';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import {
  CreateAppointmentDto,
  ListAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';

@Injectable()
export class AppointmentsService extends TransactionSupport {
  constructor(
    private readonly lambdaInvokeService: LambdaInvokeService,
    private readonly customersService: CustomersService,
    private readonly productsService: ProductsService,
    private readonly usersService: UsersService,
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
    @InjectModel('Customer')
    private readonly customerModel: Model<Customer, CustomerKey>,
    @InjectModel('Product')
    private readonly productModel: Model<Product, ProductKey>,
  ) {
    super();
  }

  async createPublic(
    body: CreateAppointmentDto,
  ): Promise<GenericResponse<Appointment>> {
    try {
      if (!body.businessInfoId) {
        throw new Error('MS014'); // BusinessInfoId is required
      }

      if (!body.startDate || !body.endDate) {
        throw new Error('MS014'); // Start and end dates are required
      }

      this.validateAppointmentDates(body.startDate, body.endDate);

      const appointment = {
        id: uuidv4(),
        startDate: new Date(body.startDate).getTime() as any,
        endDate: new Date(body.endDate).getTime() as any,
        idService: body.idService,
        idCustomer: body.idCustomer,
        idEmployee: body.idEmployee,
        status: AppointmentStatus.pending,
        businessInfoId: body.businessInfoId,
        createdBy: undefined as any,
      };

      const cleanedPayload = deleteEmptyProperties(appointment);

      await this.model.create(cleanedPayload);

      const appointmentResult = await this.model.get({ id: appointment.id });
      const appointmentData = appointmentResult.toJSON() as Appointment;

      // Invoke Lambda to sync with Google Calendar asynchronously
      await this.lambdaInvokeService.invokeGoogleCalendarSync(
        appointmentData,
        'create',
      );

      return new GenericResponse(appointmentData);
    } catch (error) {
      throw handleError(error);
    }
  }

  async create(
    body: CreateAppointmentDto,
    user: User,
  ): Promise<GenericResponse<Appointment>> {
    try {
      if (!body.startDate || !body.endDate) {
        throw new Error('MS014'); // Start and end dates are required
      }

      this.validateAppointmentDates(body.startDate, body.endDate);

      const appointment = {
        id: uuidv4(),
        startDate: new Date(body.startDate).getTime() as any,
        endDate: new Date(body.endDate).getTime() as any,
        idService: body.idService,
        idCustomer: body.idCustomer,
        idEmployee: body.idEmployee,
        status: AppointmentStatus.pending,
        businessInfoId: user.businessInfoId,
        createdBy: user.id,
      };

      const cleanedPayload = deleteEmptyProperties(appointment);

      await this.model.create(cleanedPayload);

      const appointmentResult = await this.model.get({ id: appointment.id });
      const appointmentData = appointmentResult.toJSON() as Appointment;

      // Invoke Lambda to sync with Google Calendar asynchronously
      await this.lambdaInvokeService.invokeGoogleCalendarSync(
        appointmentData,
        'create',
      );

      return new GenericResponse(appointmentData);
    } catch (error) {
      throw handleError(error);
    }
  }

  async findAllPublic(
    businessId: string,
    filters?: ListAppointmentDto,
  ): Promise<GenericResponse<Appointment[]>> {
    try {
      // Validate businessId
      if (!businessId) {
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

      if (filters?.idOrder) {
        query = query.where('idOrder').eq(filters.idOrder);
      }

      if (filters?.status) {
        query = query.where('status').eq(filters.status);
      }

      // Always filter by business
      query = query.where('businessInfoId').eq(businessId);

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

      // Remove paymentMethods from update - no longer handled here
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

      // Update appointment fields if there are any changes
      if (Object.keys(cleanedDto).length > 0) {
        await this.model.update(
          { id: appointment.id },
          { ...cleanedDto, modifiedBy: user.id },
        );
      }

      // Return updated appointment
      const updatedAppointment = await this.model.get({ id: appointment.id });

      if (!updatedAppointment) {
        throw new Error('MS007');
      }

      const appointmentData = updatedAppointment.toJSON() as Appointment;

      // Invoke Lambda to sync with Google Calendar asynchronously
      await this.lambdaInvokeService.invokeGoogleCalendarSync(
        appointmentData,
        'update',
      );

      return new GenericResponse(appointmentData);
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

      const appointmentData = updatedAppointment.toJSON() as Appointment;

      // Invoke Lambda to sync with Google Calendar asynchronously
      await this.lambdaInvokeService.invokeGoogleCalendarSync(
        appointmentData,
        'update',
      );

      return new GenericResponse(appointmentData);
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
}
