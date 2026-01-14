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

@Injectable()
export class AppointmentsPublicService extends TransactionSupport {
  constructor(
    private readonly lambdaInvokeService: LambdaInvokeService,
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
  ) {
    super();
  }

  async createPublic(
    body: CreateAppointmentDto,
  ): Promise<GenericResponse<Appointment>> {
    try {
      if (!body.idBusiness) {
        throw new Error('MS014'); // BusinessId is required
      }

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
        idBusiness: body.idBusiness,
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
