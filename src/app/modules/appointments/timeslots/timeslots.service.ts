import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import * as moment from 'moment-timezone';
import { AppointmentStatus } from 'src/app/core/constants/domain.constants';

import { GenericResponse } from '../../../core/interfaces/generic-response.interface';
import {
  Appointment,
  AppointmentKey,
} from '../../../schemas/appointment.schema';
import { Product, ProductKey } from '../../../schemas/product.schema';
import { User, UserKey } from '../../../schemas/user.schema';
import { handleError } from '../../../shared/error.functions';
import { UsersService } from '../../users/users.service';
import {
  BaseSlotDto,
  BusinessConfigDto,
  GetTimeslotsQueryDto,
  TimeslotResponseDto,
} from './dto/timeslots.dto';

@Injectable()
export class TimeslotsService {
  constructor(
    private readonly usersService: UsersService,
    @InjectModel('Appointment')
    private readonly appointmentModel: Model<Appointment, AppointmentKey>,
    @InjectModel('Product')
    private readonly productModel: Model<Product, ProductKey>,
  ) {}

  /**
   * Get available timeslots for the next N days
   */
  async getAvailableTimeslots(
    businessId: string,

    {
      serviceId,
      startDate,
      days,
      minHour,
      maxHour,
      timezoneOffset,
    }: GetTimeslotsQueryDto,
  ): Promise<GenericResponse<TimeslotResponseDto[]>> {
    try {
      let clientCurrentTime: moment.Moment | undefined;

      // Fase B: Get service, employees, and appointments
      const service = await this.getService(serviceId, businessId);
      const activeEmployees = await this.getActiveEmployees(businessId);
      const appointments = await this.getAppointments(
        businessId,
        moment(startDate),
        days,
        activeEmployees,
      );

      // Get business configuration (defaults if not configured)
      const config = await this.getBusinessConfig(
        businessId,
        minHour,
        maxHour,
        service.measure,
      );

      const baseSlots = this.generateBaseSlots(moment(startDate), config);

      const availableSlotsByEmployee = this.getAvailableSlotsByEmployee(
        baseSlots,
        appointments,
        activeEmployees,
      );

      return new GenericResponse(availableSlotsByEmployee);
    } catch (error) {
      throw handleError(error);
    }
  }

  /**
   * Get service by ID
   */
  private async getService(
    serviceId: string,
    businessId: string,
  ): Promise<Product> {
    const products = await this.productModel
      .scan()
      .where('id')
      .eq(serviceId)
      .where('businessInfoId')
      .eq(businessId)
      .exec();

    if (!products || products.length === 0) {
      throw new Error('No se encontró el servicio');
    }

    return products[0].toJSON() as Product;
  }

  /**
   * Get active employees for a business
   */
  private async getActiveEmployees(businessId: string): Promise<User[]> {
    const response = await this.usersService.findEmployees(businessId);
    if (!response.success || !response.data) {
      throw new Error('No hay empleados activos');
    }
    // Filter only active employees (status === true)
    return response.data.filter((employee: User) => employee.status === true);
  }

  /**
   * Get appointments for date range, filtered by active employees
   */
  private async getAppointments(
    businessId: string,
    startDate: moment.Moment,
    days: number,
    activeEmployees: User[],
  ): Promise<Appointment[]> {
    const employeeIds = activeEmployees.map((emp) => emp.id);
    if (employeeIds.length === 0) {
      return [];
    }

    const endDate = moment(startDate).endOf('day');

    // Convert moment dates to timestamps (milliseconds) for DynamoDB queries
    const startTimestamp = startDate.startOf('day').valueOf();
    const endTimestamp = endDate.valueOf();

    const appointments = await this.appointmentModel
      .scan()
      .where('businessInfoId')
      .eq(businessId)
      .where('startDate')
      .ge(startTimestamp as any)
      .where('startDate')
      .le(endTimestamp as any)
      .where('idEmployee')
      .in(employeeIds)
      .exec();

    return appointments.map((appt) => appt.toJSON() as Appointment);
  }

  /**
   * Get business configuration (minHour, maxHour, splitTime)
   * TODO: This could be fetched from a domains/business config service
   * For now, using defaults or provided values
   */
  private async getBusinessConfig(
    businessId: string,
    minHour: string,
    maxHour: string,
    serviceTime: number,
  ): Promise<BusinessConfigDto> {
    // Default configuration
    // TODO: Fetch from domains or business config if available
    return {
      minHour: minHour || '08:00',
      maxHour: maxHour || '18:00',
      splitTime: serviceTime + 5, // 5 minutes default
    };
  }

  /**
   * Fase A: Generate base slots (skeleton) for all days
   */
  private generateBaseSlots(
    startDate: moment.Moment,
    config: BusinessConfigDto,
  ): BaseSlotDto[] {
    const baseSlots: BaseSlotDto[] = [];

    // Parse minHour and maxHour
    const [minHour, minMinute] = config.minHour.split(':').map(Number);
    const [maxHour, maxMinute] = config.maxHour.split(':').map(Number);

    const startTime = moment(startDate)
      .startOf('day')
      .set({ hour: minHour, minute: minMinute, second: 0, millisecond: 0 });
    const endTime = moment(startDate)
      .startOf('day')
      .set({ hour: maxHour, minute: maxMinute, second: 0, millisecond: 0 });

    while (startTime.isBefore(endTime)) {
      baseSlots.push({
        start: startTime.toDate(),
        end: endTime.toDate(),
      });
      startTime.add(config.splitTime, 'minutes');
    }
    return baseSlots;
  }

  /**
   * Fase C: Filter available slots using the alternative approach
   * Calculate occupied slots per employee and merge them
   */
  private getAvailableSlotsByEmployee(
    baseSlots: BaseSlotDto[],
    appointments: Appointment[],
    activeEmployees: User[],
  ): TimeslotResponseDto[] {
    // Helper function to check overlap using moment's exact functions
    const isOverlapping = (
      slotStart: Date,
      slotEnd: Date,
      apptStart: Date,
      apptEnd: Date,
    ): boolean => {
      return (
        moment(slotStart).isSameOrBefore(apptStart) &&
        moment(slotEnd).isSameOrBefore(apptEnd)
      );
    };

    const freeSlots = activeEmployees.map((employee) => ({
      idEmployee: employee.id,
      availableSlots: baseSlots.filter(
        (slot) =>
          !appointments.some((appt) =>
            isOverlapping(slot.start, slot.end, appt.startDate, appt.endDate),
          ),
      ),
    }));

    return freeSlots;
  }
}
