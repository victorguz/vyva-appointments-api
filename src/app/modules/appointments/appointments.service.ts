import { Injectable } from '@nestjs/common';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import { AppointmentStatus } from 'src/app/core/constants/domain.constants';
import { User, UserKey } from 'src/app/schemas/user.schema';
import { v4 as uuidv4 } from 'uuid';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import {
  Appointment,
  AppointmentKey,
  AppointmentService,
} from '../../schemas/appointment.schema';
import { handleError } from '../../shared/error.functions';
import {
  deleteEmptyProperties,
  sanitizeNumericValue,
} from '../../shared/shared.functions';
import {
  hasCustomerGoogleCalendarEvent,
  serializeGoogleCalendarEventIds,
} from '../../shared/google-calendar-event-ids.storage';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import {
  CreateAppointmentDto,
  ListAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';
import { Customer, CustomerKey } from 'src/app/schemas/customer.schema';
@Injectable()
export class AppointmentsService extends TransactionSupport {
  constructor(
    private readonly lambdaInvokeService: LambdaInvokeService,
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
    @InjectModel('Customer')
    private readonly customerModel: Model<Customer, CustomerKey>,
    @InjectModel('User')
    private readonly userModel: Model<User, UserKey>,
  ) {
    super();
  }

  private static readonly GOOGLE_SYNC_WARNING_MESSAGE =
    'Cita guardada, pero no se pudo sincronizar con Google Calendar';

  private formatServiceNamesSummaryFromServices(
    services: AppointmentService[],
  ): string {
    const names = services.map((s) => (s.name || '').trim()).filter(Boolean);
    if (names.length === 0) return '';
    const maxPerName = 28;
    const ellipsis = '\u2026';
    const dot = '\u00b7';
    const truncate = (t: string) =>
      t.length <= maxPerName
        ? t
        : t.slice(0, Math.max(0, maxPerName - 1)) + ellipsis;
    const parts = names.map(truncate);
    const joined = parts.join(', ');
    return names.length > 1
      ? `${joined} ${dot} ${names.length} \u00edtems`
      : joined;
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

      // Base query: siempre usar idBusiness-index como principal
      let businessQuery = this.model
        .query('idBusiness')
        .using('idBusiness-index')
        .eq(user.idBusiness);

      // Serie de sesiones: devolver padre + hijos
      if (filters?.idParent) {
        const children = await businessQuery
          .where('idParent')
          .eq(filters.idParent)
          .exec();
        const parent = await this.model.get({ id: filters.idParent });

        const series: Appointment[] = [...children];
        if (parent?.idBusiness === user.idBusiness) {
          series.push(parent);
        }

        const unique = Array.from(
          new Map(series.map((a) => [a.id, a])).values(),
        );
        return new GenericResponse(
          unique.sort((a, b) => {
            const sessionA = a.sessionNumber ?? Number.MAX_SAFE_INTEGER;
            const sessionB = b.sessionNumber ?? Number.MAX_SAFE_INTEGER;
            if (sessionA !== sessionB) return sessionA - sessionB;
            return a.startDate.getTime() - b.startDate.getTime();
          }),
        );
      }

      // Filtros acumulativos sobre la misma query
      if (filters?.idOrder) {
        businessQuery = businessQuery.where('idOrder').eq(filters.idOrder);
      }
      if (filters?.idCustomer) {
        businessQuery = businessQuery
          .where('idCustomer')
          .eq(filters.idCustomer);
      }
      if (filters?.idEmployee) {
        businessQuery = businessQuery
          .where('idEmployee')
          .eq(filters.idEmployee);
      }
      if (filters?.status) {
        businessQuery = businessQuery.where('status').eq(filters.status);
      }
      if (filters?.startDate) {
        businessQuery = businessQuery
          .where('endDate')
          .ge(new Date(filters.startDate).getTime());
      }
      if (filters?.endDate) {
        businessQuery = businessQuery
          .where('startDate')
          .le(new Date(filters.endDate).getTime());
      }

      appointments = await businessQuery.exec();

      return new GenericResponse(
        appointments
          // by createdAt descending
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
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
    const allPayloads: Appointment[] = [];
    try {
      const validAdditionalSessions = (body.additionalSessions ?? []).filter(
        (session) => !!session?.startDate && !!session?.endDate,
      );
      const isSeries = validAdditionalSessions.length > 0;

      // Build parent appointment
      const parentPayload = await this.createAppointmentObject(body, user);
      if (isSeries) {
        parentPayload.sessionNumber = 1;
      }
      allPayloads.push(parentPayload);

      // Build additional sessions if any
      if (isSeries) {
        for (let i = 0; i < validAdditionalSessions.length; i++) {
          const session = validAdditionalSessions[i];
          const childPayload = await this.createAppointmentObject(
            { ...body, startDate: session.startDate, endDate: session.endDate },
            user,
          );
          childPayload.idParent = parentPayload.id;
          childPayload.sessionNumber = i + 2;
          allPayloads.push(childPayload);
        }
      }

      // Single transaction for all appointments
      await this.transaction(
        allPayloads.map((p) => this.model.transaction.create(p)),
      );

      // Sync all to Google Calendar
      const syncResult = await this.syncAllToGoogleCalendar(
        allPayloads,
        user,
        body.sendGoogleCalendar ?? false,
      );

      const parentWithSync = await this.model.get({ id: parentPayload.id });
      return syncResult.synced
        ? new GenericResponse(parentWithSync)
        : new GenericResponse(
            parentWithSync,
            true,
            AppointmentsService.GOOGLE_SYNC_WARNING_MESSAGE,
          );
    } catch (error) {
      for (const payload of allPayloads) {
        try {
          await this.model.delete(payload);
        } catch (_) {}
      }
      throw handleError(error);
    }
  }

  private async createAppointmentObject(
    body: CreateAppointmentDto,
    user: User,
  ): Promise<Appointment> {
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

    // Process services array or create from single service for backwards compatibility
    let services = body.services;
    if (!services || services.length === 0) {
      // Backwards compatibility: create services array from single idService
      if (body.idService) {
        services = [
          {
            id: body.idService,
            name: body.serviceName || '', // Will be populated by sales order
            price: 0,
            offerPrice: 0,
            measure: 0,
          },
        ];
      }
    }

    // Get customer name if not provided but idCustomer exists
    let customerName = body.customerName;
    if (!customerName && body.idCustomer) {
      customerName = await this.resolveCustomerName(body.idCustomer);
    }

    // Resolve employeeName from User schema if not provided
    let employeeName = body.employeeName ?? '';
    if (!employeeName && body.idEmployee) {
      employeeName = await this.resolveEmployeeName(body.idEmployee);
    }

    const appointment: Appointment = {
      id: uuidv4(),
      startDate: sanitizeNumericValue(startDateTimestamp) as any,
      endDate: sanitizeNumericValue(endDateTimestamp) as any,
      idService:
        body.idService ||
        (services && services.length > 0 ? services[0].id : ''),
      idCustomer: body.idCustomer,
      idEmployee: body.idEmployee,
      status: AppointmentStatus.pending,
      idBusiness: user.idBusiness,
      createdBy: user.id,
      googleCalendarId: body.googleCalendarId,
      googleCalendarEventId: body.googleCalendarEventId,
      googleCalendarEmployeeEventId: body.googleCalendarEventId,
      googleCalendarCustomerEventId: undefined,
      customerName: customerName,
      serviceName: body.serviceName || body.services?.[0]?.name || '',
      employeeName: employeeName,
      notes: body.notes,
      services: services,
    };

    // Prepare products for sales order from services array

    return deleteEmptyProperties({
      ...appointment,
    });
  }

  async createTimeOutAppointment(
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

      // Get customer name if not provided but idCustomer exists
      let customerName = body.customerName;
      if (!customerName && body.idCustomer) {
        customerName = await this.resolveCustomerName(body.idCustomer);
      }

      const appointment: Appointment = {
        id: uuidv4(),
        startDate: sanitizeNumericValue(startDateTimestamp) as any,
        endDate: sanitizeNumericValue(endDateTimestamp) as any,
        idCustomer: body.idCustomer,
        idEmployee: body.idEmployee,
        status: AppointmentStatus.timeOut, // Status específico para appointments sin servicio
        idBusiness: user.idBusiness,
        createdBy: user.id,
        googleCalendarId: body.googleCalendarId,
        googleCalendarEventId: body.googleCalendarEventId,
        googleCalendarEmployeeEventId: body.googleCalendarEventId,
        googleCalendarCustomerEventId: undefined,
        customerName: customerName,
        serviceName: body.serviceName || '',
        notes: body.notes,
        services: [] as AppointmentService[], // Sin servicios
      };

      appointmentPayload = deleteEmptyProperties(appointment);

      await this.model.create(appointmentPayload);

      const appointmentData = await this.model.get({ id: appointment.id });
      const syncResult = await this.syncAppointmentToGoogleCalendar(
        appointmentData.toJSON() as Appointment,
        user,
        body.sendGoogleCalendar ?? false,
      );
      const appointmentWithSync = await this.model.get({ id: appointment.id });
      return syncResult.synced
        ? new GenericResponse(appointmentWithSync)
        : new GenericResponse(
            appointmentWithSync,
            true,
            AppointmentsService.GOOGLE_SYNC_WARNING_MESSAGE,
          );
    } catch (error) {
      if (appointmentPayload) await this.model.delete(appointmentPayload);

      throw handleError(error);
    }
  }

  /**
   * Sync all appointments in a series to Google Calendar.
   * Failures are non-fatal — returns { synced: false } if any fails.
   */
  private async syncAllToGoogleCalendar(
    payloads: Appointment[],
    user: User,
    sendGoogleCalendar: boolean,
  ): Promise<{ synced: boolean }> {
    let allSynced = true;
    for (const payload of payloads) {
      const appointmentData = await this.model.get({ id: payload.id });
      if (!appointmentData) continue;
      const result = await this.syncAppointmentToGoogleCalendar(
        appointmentData.toJSON() as Appointment,
        user,
        sendGoogleCalendar,
      );
      if (!result.synced) allSynced = false;
    }
    return { synced: allSynced };
  }

  /**
   * Sync appointment to Google Calendar Vyva calendar
   */
  private async syncAppointmentToGoogleCalendar(
    appointment: Appointment,
    user: User,
    sendGoogleCalendar: boolean,
  ): Promise<{ synced: boolean; warningMessage?: string }> {
    try {
      const result = await this.lambdaInvokeService.invokeFunction(
        'vyva-integrations',
        'POST',
        '/api/integrations/google-calendar/events/vyva',
        {
          appointmentId: appointment.id,
          sendGoogleCalendar,
        },
        user,
      );
      console.log({ result });
      if (result.data?.eventId) {
        const customerEventId = result.data.customerEventId || undefined;
        await this.model.update(
          { id: appointment.id },
          {
            googleCalendarEventId: serializeGoogleCalendarEventIds(
              result.data.eventId,
              customerEventId,
            ),
            googleCalendarEmployeeEventId: result.data.eventId,
            googleCalendarCustomerEventId: customerEventId,
          },
        );
        return { synced: true };
      }

      return {
        synced: false,
        warningMessage: AppointmentsService.GOOGLE_SYNC_WARNING_MESSAGE,
      };
    } catch (error) {
      console.error('[syncAppointmentToGoogleCalendar] Error:', error);
      return {
        synced: false,
        warningMessage: AppointmentsService.GOOGLE_SYNC_WARNING_MESSAGE,
      };
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
      const previousAppointment = appointment.toJSON() as Appointment;
      // Validar que pertenece al negocio del usuario
      if (appointment.idBusiness !== user.idBusiness) {
        throw new Error('MS007');
      }
      // Only validate dates if both are provided in the update
      if (updateAppointmentDto.startDate && updateAppointmentDto.endDate) {
        this.validateAppointmentDates(
          updateAppointmentDto.startDate,
          updateAppointmentDto.endDate,
        );
      }
      const cleanedUpdateDto = deleteEmptyProperties(updateAppointmentDto);
      // Preserve notes when explicitly set (even to empty string) so clearing works
      if ('notes' in updateAppointmentDto) {
        (cleanedUpdateDto as any).notes = updateAppointmentDto.notes ?? '';
      }
      const cleanedDto = cleanedUpdateDto;
      delete (cleanedDto as any).sendGoogleCalendar;

      // Handle date conversions - convert string dates to Date objects for Dynamoose
      if (cleanedDto.startDate) {
        const startDate = new Date(cleanedDto.startDate);
        if (isNaN(startDate.getTime())) {
          throw new Error('MS042'); // Invalid date format
        }
        cleanedDto.startDate = startDate;
      }
      if (cleanedDto.endDate) {
        const endDate = new Date(cleanedDto.endDate);
        if (isNaN(endDate.getTime())) {
          throw new Error('MS042'); // Invalid date format
        }
        cleanedDto.endDate = endDate;
      }

      // Calculate serviceName if services are provided
      if (cleanedDto.services && cleanedDto.services.length > 0) {
        cleanedDto.serviceName = this.formatServiceNamesSummaryFromServices(
          cleanedDto.services,
        );

        // Update idService for backwards compatibility
        cleanedDto.idService = cleanedDto.services[0].id;
      }

      // Resolve customerName from Customer schema if idCustomer is updated but name not provided
      if (cleanedDto.idCustomer && !cleanedDto.customerName) {
        cleanedDto.customerName = await this.resolveCustomerName(
          cleanedDto.idCustomer,
        );
      }

      // Resolve employeeName from User schema if idEmployee is updated but name not provided
      if (cleanedDto.idEmployee && !cleanedDto.employeeName) {
        cleanedDto.employeeName = await this.resolveEmployeeName(
          cleanedDto.idEmployee,
        );
      }

      // Prepare sales order updates only if appointment has an order
      const transactionItems: any[] = [
        this.model.transaction.update(
          { id: appointment.id },
          { ...cleanedDto, modifiedBy: user.id },
        ),
      ];

      // Update appointment fields if there are any changes
      await this.transaction(transactionItems);

      const appointmentData = await this.model.get({ id: appointment.id });
      const sendGoogleCalendar =
        updateAppointmentDto.sendGoogleCalendar !== undefined
          ? updateAppointmentDto.sendGoogleCalendar
          : hasCustomerGoogleCalendarEvent(
              previousAppointment.googleCalendarEventId,
            );
      const syncResult = await this.syncAppointmentToGoogleCalendar(
        appointmentData.toJSON() as Appointment,
        user,
        sendGoogleCalendar,
      );
      const appointmentWithSync = await this.model.get({ id: appointment.id });
      return syncResult.synced
        ? new GenericResponse(appointmentWithSync)
        : new GenericResponse(
            appointmentWithSync,
            true,
            AppointmentsService.GOOGLE_SYNC_WARNING_MESSAGE,
          );
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
      await this.syncAppointmentToGoogleCalendar(appointmentData, user, true);

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

  private async resolveCustomerName(idCustomer: string): Promise<string> {
    try {
      const customer = await this.customerModel.get({ id: idCustomer });
      if (!customer) return '';
      const customerData = customer.toJSON();
      return (
        [customerData.firstName, customerData.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Sin nombre'
      );
    } catch (error) {
      console.error('[resolveCustomerName] Error:', error);
      return '';
    }
  }

  private async resolveEmployeeName(idEmployee: string): Promise<string> {
    try {
      const employee = await this.userModel.get({ id: idEmployee });
      if (!employee) return '';
      const employeeData = employee.toJSON();
      return employeeData.name || employeeData.email || '';
    } catch (error) {
      console.error('[resolveEmployeeName] Error:', error);
      return '';
    }
  }
}
