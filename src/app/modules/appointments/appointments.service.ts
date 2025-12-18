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

      // OPTIMIZACIÓN: Usar query con GSI en lugar de scan
      let appointments: Appointment[] = [];

      // Si hay filtro por idOrder, usar order-index (más específico)
      if (filters?.idOrder) {
        const orderQuery = await this.model
          .query('idOrder')
          .using('order-index')
          .eq(filters.idOrder)
          .exec();
        
        appointments = orderQuery.filter(
          (apt) => apt.businessInfoId === businessId &&
            (!filters.idCustomer || apt.idCustomer === filters.idCustomer) &&
            (!filters.idEmployee || apt.idEmployee === filters.idEmployee) &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si hay filtro por idCustomer, usar customer-index
      else if (filters?.idCustomer) {
        const customerQuery = await this.model
          .query('idCustomer')
          .using('customer-index')
          .eq(filters.idCustomer)
          .exec();
        
        appointments = customerQuery.filter(
          (apt) => apt.businessInfoId === businessId &&
            (!filters.idEmployee || apt.idEmployee === filters.idEmployee) &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si hay filtro por idEmployee, usar employee-index
      else if (filters?.idEmployee) {
        const employeeQuery = await this.model
          .query('idEmployee')
          .using('employee-index')
          .eq(filters.idEmployee)
          .exec();
        
        appointments = employeeQuery.filter(
          (apt) => apt.businessInfoId === businessId &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si hay filtro por status, usar status-index
      else if (filters?.status) {
        const statusQuery = await this.model
          .query('status')
          .using('status-index')
          .eq(filters.status)
          .exec();
        
        appointments = statusQuery.filter(
          (apt) => apt.businessInfoId === businessId &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si no hay filtros específicos, usar businessInfo-index como base
      else {
        const businessQuery = await this.model
          .query('businessInfoId')
          .using('businessInfo-index')
          .eq(businessId)
          .exec();
        
        appointments = businessQuery.filter(
          (apt) => {
            const startDateMatch = !filters?.startDate || 
              new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime();
            const endDateMatch = !filters?.endDate || 
              new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime();
            
            return startDateMatch && endDateMatch;
          }
        );
      }

      return new GenericResponse(appointments.map(
        (appointment) => appointment as Appointment,
      ));
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

      // OPTIMIZACIÓN: Usar query con GSI en lugar de scan
      let appointments: Appointment[] = [];

      // Si hay filtro por idOrder, usar order-index (más específico)
      if (filters?.idOrder) {
        const orderQuery = await this.model
          .query('idOrder')
          .using('order-index')
          .eq(filters.idOrder)
          .exec();
        
        appointments = orderQuery.filter(
          (apt) => apt.businessInfoId === user.businessInfoId &&
            (!filters.idCustomer || apt.idCustomer === filters.idCustomer) &&
            (!filters.idEmployee || apt.idEmployee === filters.idEmployee) &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si hay filtro por idCustomer, usar customer-index
      else if (filters?.idCustomer) {
        const customerQuery = await this.model
          .query('idCustomer')
          .using('customer-index')
          .eq(filters.idCustomer)
          .exec();
        
        appointments = customerQuery.filter(
          (apt) => apt.businessInfoId === user.businessInfoId &&
            (!filters.idEmployee || apt.idEmployee === filters.idEmployee) &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si hay filtro por idEmployee, usar employee-index
      else if (filters?.idEmployee) {
        const employeeQuery = await this.model
          .query('idEmployee')
          .using('employee-index')
          .eq(filters.idEmployee)
          .exec();
        
        appointments = employeeQuery.filter(
          (apt) => apt.businessInfoId === user.businessInfoId &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si hay filtro por status, usar status-index
      else if (filters?.status) {
        const statusQuery = await this.model
          .query('status')
          .using('status-index')
          .eq(filters.status)
          .exec();
        
        appointments = statusQuery.filter(
          (apt) => apt.businessInfoId === user.businessInfoId &&
            (!filters.startDate || new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime()) &&
            (!filters.endDate || new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime())
        );
      }
      // Si no hay filtros específicos, usar businessInfo-index como base
      else {
        const businessQuery = await this.model
          .query('businessInfoId')
          .using('businessInfo-index')
          .eq(user.businessInfoId)
          .exec();
        
        appointments = businessQuery.filter(
          (apt) => {
            const startDateMatch = !filters?.startDate || 
              new Date(apt.startDate).getTime() >= new Date(filters.startDate).getTime();
            const endDateMatch = !filters?.endDate || 
              new Date(apt.endDate).getTime() <= new Date(filters.endDate).getTime();
            
            return startDateMatch && endDateMatch;
          }
        );
      }

      return new GenericResponse(appointments.map(
        (appointment) => appointment as Appointment,
      ));
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

      // OPTIMIZACIÓN: Usar get() en lugar de scan() para búsqueda por ID (clave primaria)
      const appointment = await this.model.get({ id });

      if (!appointment) {
        throw new Error('MS007');
      }

      // Validar que pertenece al negocio del usuario
      if (appointment.businessInfoId !== user.businessInfoId) {
        throw new Error('MS007');
      }

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
