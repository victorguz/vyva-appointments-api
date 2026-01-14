import { Injectable } from '@nestjs/common';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import { AppointmentStatus } from 'src/app/core/constants/domain.constants';
import { User } from 'src/app/schemas/user.schema';
import { v4 as uuidv4 } from 'uuid';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { handleError } from '../../shared/error.functions';
import {
  deleteEmptyProperties,
  sanitizeNumericValue,
} from '../../shared/shared.functions';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import {
  CreateAppointmentDto,
  ListAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';
import { SalesOrder, SalesOrderKey } from 'src/app/schemas/sales-order.schema';
import { SalesOrdersService } from '../sales-orders/sales-orders.service';
import { TransactionReturnOptions } from 'dynamoose/dist/Transaction';

@Injectable()
export class AppointmentsService extends TransactionSupport {
  constructor(
    private readonly lambdaInvokeService: LambdaInvokeService,
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
    @InjectModel('SalesOrder')
    private readonly salesOrderModel: Model<SalesOrder, SalesOrderKey>,
    private readonly salesOrderService: SalesOrdersService,
  ) {
    super();
  }

  async findAll(
    user: User,
    filters?: ListAppointmentDto,
  ): Promise<GenericResponse<Appointment[]>> {
    try {
      // Validate user and idBusiness
      if (!user || !user.idBusiness) {
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
          (apt) =>
            apt.idBusiness === user.idBusiness &&
            (!filters.idCustomer || apt.idCustomer === filters.idCustomer) &&
            (!filters.idEmployee || apt.idEmployee === filters.idEmployee) &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate ||
              new Date(apt.startDate).getTime() >=
                new Date(filters.startDate).getTime()) &&
            (!filters.endDate ||
              new Date(apt.endDate).getTime() <=
                new Date(filters.endDate).getTime()),
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
          (apt) =>
            apt.idBusiness === user.idBusiness &&
            (!filters.idEmployee || apt.idEmployee === filters.idEmployee) &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate ||
              new Date(apt.startDate).getTime() >=
                new Date(filters.startDate).getTime()) &&
            (!filters.endDate ||
              new Date(apt.endDate).getTime() <=
                new Date(filters.endDate).getTime()),
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
          (apt) =>
            apt.idBusiness === user.idBusiness &&
            (!filters.status || apt.status === filters.status) &&
            (!filters.startDate ||
              new Date(apt.startDate).getTime() >=
                new Date(filters.startDate).getTime()) &&
            (!filters.endDate ||
              new Date(apt.endDate).getTime() <=
                new Date(filters.endDate).getTime()),
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
          (apt) =>
            apt.idBusiness === user.idBusiness &&
            (!filters.startDate ||
              new Date(apt.startDate).getTime() >=
                new Date(filters.startDate).getTime()) &&
            (!filters.endDate ||
              new Date(apt.endDate).getTime() <=
                new Date(filters.endDate).getTime()),
        );
      }
      // Si no hay filtros específicos, usar idBusiness-index como base
      else {
        const businessQuery = await this.model
          .query('idBusiness')
          .using('idBusiness-index')
          .eq(user.idBusiness)
          .exec();

        appointments = businessQuery.filter((apt) => {
          const startDateMatch =
            !filters?.startDate ||
            new Date(apt.startDate).getTime() >=
              new Date(filters.startDate).getTime();
          const endDateMatch =
            !filters?.endDate ||
            new Date(apt.endDate).getTime() <=
              new Date(filters.endDate).getTime();

          return startDateMatch && endDateMatch;
        });
      }

      return new GenericResponse(
        appointments.map((appointment) => appointment as Appointment),
      );
    } catch (error) {
      throw handleError(error);
    }
  }

  async findAllByCustomer(user: User): Promise<GenericResponse<Appointment[]>> {
    try {
      // Validate user
      if (!user || !user.id) {
        throw new Error('MS014');
      }

      // Use customer-index to query appointments by customer ID
      const customerQuery = await this.model
        .query('idCustomer')
        .using('customer-index')
        .eq(user.id)
        .exec();

      return new GenericResponse(customerQuery);
    } catch (error) {
      throw handleError(error);
    }
  }

  async create(
    body: CreateAppointmentDto,
    user: User,
  ): Promise<GenericResponse<Appointment>> {
    let appointmentPayload;
    try {
      if (!body.startDate || !body.endDate) {
        throw new Error('MS014'); // Start and end dates are required
      }

      this.validateAppointmentDates(body.startDate, body.endDate);

      const startDateTimestamp = new Date(body.startDate).getTime();
      const endDateTimestamp = new Date(body.endDate).getTime();

      // Validate that dates are valid and not Infinity
      if (
        !isFinite(startDateTimestamp) ||
        !isFinite(endDateTimestamp) ||
        isNaN(startDateTimestamp) ||
        isNaN(endDateTimestamp)
      ) {
        throw new Error('MS042'); // Invalid date format
      }

      const appointment = {
        id: uuidv4(),
        startDate: sanitizeNumericValue(startDateTimestamp) as any,
        endDate: sanitizeNumericValue(endDateTimestamp) as any,
        idService: body.idService,
        idCustomer: body.idCustomer,
        idEmployee: body.idEmployee,
        status: AppointmentStatus.pending,
        idBusiness: user.idBusiness,
        createdBy: user.id,
        googleCalendarId: body.googleCalendarId,
        googleCalendarEventId: body.googleCalendarEventId,
      };

      const salesOrder: SalesOrder =
        await this.salesOrderService.createOrderObject(
          {
            idCustomer: body.idCustomer,
            products: [
              {
                id: body.idService,
                quantity: 1,
              },
            ],
            paymentMethods: body.paymentMethods,
          },
          user,
        );

      appointmentPayload = deleteEmptyProperties({
        ...appointment,
        idOrder: salesOrder.id,
      });
      // await this.model.create(cleanedPayload);

      // const appointmentResult = await this.model.get({ id: appointment.id });
      // const appointmentData = appointmentResult.toJSON() as Appointment;

      // Invoke Lambda to sync with Google Calendar asynchronously
      // await this.lambdaInvokeService.invokeGoogleCalendarSync(
      //   appointmentData,
      //   'create',
      // );
      await this.transaction([
        this.model.transaction.create(appointmentPayload),
        this.salesOrderModel.transaction.create(salesOrder),
      ]);

      const appointmentData = await this.model.get({ id: appointment.id });
      await this.syncAppointmentToGoogleCalendar(
        appointmentData.toJSON() as Appointment,
        user,
      );
      return new GenericResponse(appointmentData);
    } catch (error) {
      if (appointmentPayload) await this.model.delete(appointmentPayload);
      if (appointmentPayload?.idOrder)
        await this.salesOrderModel.delete({ id: appointmentPayload.idOrder });

      throw handleError(error);
    }
  }

  /**
   * Sync appointment to Google Calendar Vyva calendar
   */
  private async syncAppointmentToGoogleCalendar(
    appointment: Appointment,
    user: User,
  ): Promise<void> {
    try {
      // Call integrations-api to create event in Vyva calendar
      const result = await this.lambdaInvokeService.invokeFunction(
        'vyva-integrations',
        'POST',
        '/api/integrations/google-calendar/events/vyva',
        {
          summary: `Cita - ${appointment.idService}`,
          description: `Appointment ID: ${appointment.id}`,
          start: {
            dateTime: new Date(appointment.startDate).toISOString(),
            timeZone: 'America/Bogota',
          },
          end: {
            dateTime: new Date(appointment.endDate).toISOString(),
            timeZone: 'America/Bogota',
          },
        },
        user,
      );

      if (result.data?.eventId) {
        // Update appointment with Google event ID
        await this.model.update(
          { id: appointment.id },
          {
            googleCalendarEventId: result.data.eventId,
          },
        );
        console.log('[syncAppointmentToGoogleCalendar] Synced successfully');
      }
    } catch (error) {
      console.error('[syncAppointmentToGoogleCalendar] Error:', error);
      throw error;
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
      if (appointment.idBusiness !== user.idBusiness) {
        throw new Error('MS007');
      }
      this.validateAppointmentDates(
        updateAppointmentDto.startDate,
        updateAppointmentDto.endDate,
      );
      // Remove paymentMethods from update - no longer handled here
      const cleanedUpdateDto = deleteEmptyProperties(updateAppointmentDto);
      const { paymentMethods, ...cleanedDto } = cleanedUpdateDto as any;

      // Handle date conversions and validation
      // if (cleanedDto.startDate) {
      //   const startDateTimestamp = new Date(cleanedDto.startDate).getTime();
      //   if (!isFinite(startDateTimestamp) || isNaN(startDateTimestamp)) {
      //     throw new Error('MS042'); // Invalid date format
      //   }
      //   cleanedDto.startDate = sanitizeNumericValue(startDateTimestamp) as any;
      // }
      // if (cleanedDto.endDate) {
      //   const endDateTimestamp = new Date(cleanedDto.endDate).getTime();
      //   if (!isFinite(endDateTimestamp) || isNaN(endDateTimestamp)) {
      //     throw new Error('MS042'); // Invalid date format
      //   }
      //   cleanedDto.endDate = sanitizeNumericValue(endDateTimestamp) as any;
      // }

      // // Validate dates if both are provided
      // if (cleanedDto.startDate && cleanedDto.endDate) {
      //   this.validateAppointmentDates(
      //     cleanedDto.startDate.toString(),
      //     cleanedDto.endDate.toString(),
      //   );
      // }

      // Update appointment fields if there are any changes
      const response = await this.transaction([
        this.model.transaction.update(
          { id: appointment.id },
          { ...cleanedDto, modifiedBy: user.id },
        ),
        this.salesOrderModel.transaction.update(
          { id: appointment.idOrder },
          { ...cleanedDto, modifiedBy: user.id },
        ),
      ]);

      const appointmentData = response.data[0].toJSON() as Appointment;
      //  try {
      //    await this.syncAppointmentToGoogleCalendar(
      //      appointmentData.toJSON() as Appointment,
      //      user,
      //    );
      //  } catch (error) {
      //    console.error('[create] Failed to sync with Google Calendar:', error);
      //    // Don't fail appointment creation if Google sync fails
      //  }
      return new GenericResponse(appointmentData);
    } catch (error) {
      throw handleError(error);
    }
  }

  async updateStatus(
    id: string,
    updateStatusDto: UpdateAppointmentStatusDto,
    user?: User,
  ): Promise<GenericResponse<Appointment>> {
    try {
      // Validate id and status
      if (!id) {
        throw new Error('MS014');
      }
      if (!updateStatusDto.status) {
        throw new Error('MS014');
      }

      // Get the appointment to validate ownership
      const appointment = await this.model.get({ id });

      if (!appointment) {
        throw new Error('MS007');
      }

      // If user is provided, validate ownership
      if (user) {
        // If user has idBusiness, they're a business user - validate business ownership
        if (user.idBusiness) {
          if (appointment.idBusiness !== user.idBusiness) {
            throw new Error('MS007');
          }
        } else {
          // User is a customer - validate customer ownership
          if (appointment.idCustomer !== user.id) {
            throw new Error('MS007');
          }
        }
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
    console.log('start', start);
    console.log('end', end);
    console.log('isNaN(start.getTime())', isNaN(start.getTime()));
    console.log('isNaN(end.getTime())', isNaN(end.getTime()));
    console.log('start >= end', start >= end);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error('MS042');
    }

    if (start >= end) {
      throw new Error('MS041');
    }
    console.log('validateAppointmentDates');
  }
}
