import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { v4 as uuidv4 } from 'uuid';

import { AppointmentStatus } from 'src/app/core/constants/domain.constants';
import { User } from 'src/app/schemas/user.schema';
import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import {
  Appointment,
  AppointmentKey,
  AppointmentService,
} from '../../schemas/appointment.schema';
import { deleteEmptyProperties, sanitizeNumericValue } from '../../shared/shared.functions';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { RealtimePublisherService } from '../shared/realtime-publisher.service';
import { CreateTimeOutAppointmentDto } from './dto/appointments.dto';

/**
 * Creates one time-off ("tiempo fuera") appointment per employee in a single
 * request. Kept independent from AppointmentsService.create() — the general
 * flow used by appointments with other statuses — since time-off blocks
 * never need services, sales orders, or customer-facing Google Calendar
 * invites / automation webhooks.
 */
@Injectable()
export class TimeOutAppointmentsService {
  constructor(
    private readonly lambdaInvokeService: LambdaInvokeService,
    private readonly realtimePublisher: RealtimePublisherService,
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
  ) {}

  async createBatch(
    dto: CreateTimeOutAppointmentDto,
    user: User,
  ): Promise<GenericResponse<Appointment[]>> {
    if (!dto.startDate || !dto.endDate) {
      throw new Error('MS014'); // Start and end dates are required
    }
    this.validateAppointmentDates(dto.startDate, dto.endDate);

    const startDateTimestamp = new Date(dto.startDate).getTime();
    const endDateTimestamp = new Date(dto.endDate).getTime();
    if (
      !isFinite(startDateTimestamp) ||
      !isFinite(endDateTimestamp) ||
      isNaN(startDateTimestamp) ||
      isNaN(endDateTimestamp)
    ) {
      throw new Error('MS042'); // Invalid date format
    }

    if (!dto.employeeIds || dto.employeeIds.length === 0) {
      throw new Error('MS014'); // At least one employee is required
    }

    const created: Appointment[] = [];
    try {
      for (const idEmployee of dto.employeeIds) {
        const payload = deleteEmptyProperties({
          id: uuidv4(),
          startDate: sanitizeNumericValue(startDateTimestamp) as any,
          endDate: sanitizeNumericValue(endDateTimestamp) as any,
          idEmployee,
          status: AppointmentStatus.timeOut,
          idBusiness: user.idBusiness,
          createdBy: user.id,
          customerName: dto.customerName,
          serviceName: dto.serviceName || '',
          services: [] as AppointmentService[],
        }) as Appointment;

        await this.model.create(payload);
        const saved = await this.model.get({ id: payload.id });
        if (!saved) {
          throw new Error('MS007');
        }

        await this.syncAppointmentToGoogleCalendar(
          saved.toJSON() as Appointment,
          user,
        );

        const withSync = await this.model.get({ id: payload.id });
        const finalAppointment = (withSync ?? saved).toJSON() as Appointment;
        this.notifyAppointmentChange(finalAppointment);
        created.push(finalAppointment);
      }

      return new GenericResponse(created);
    } catch (error) {
      for (const appointment of created) {
        try {
          await this.model.delete({ id: appointment.id });
        } catch (_) {}
      }
      throw error;
    }
  }

  private async syncAppointmentToGoogleCalendar(
    appointment: Appointment,
    user: User,
  ): Promise<void> {
    try {
      const result = await this.lambdaInvokeService.invokeFunction(
        'vyva-integrations',
        'POST',
        '/api/integrations/google-calendar/events/vyva',
        {
          appointmentId: appointment.id,
          sendGoogleCalendar: false, // time-off blocks never invite the customer
        },
        user,
      );
      if (result.data?.eventId) {
        await this.model.update(
          { id: appointment.id },
          {
            googleCalendarId: result.data.employeeCalendarId,
            googleCalendarEventId: result.data.eventId,
            googleCalendarEmployeeEventId: result.data.eventId,
          },
        );
      }
    } catch (error) {
      console.error('[TimeOutAppointmentsService] Google Calendar sync failed:', error);
    }
  }

  private notifyAppointmentChange(appointment: Appointment): void {
    if (!appointment.idBusiness) return;
    void this.realtimePublisher.publishAppointmentChange({
      idBusiness: appointment.idBusiness,
      action: 'created',
      appointmentId: appointment.id,
      startDate: new Date(appointment.startDate).toISOString(),
      endDate: new Date(appointment.endDate).toISOString(),
    });
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
