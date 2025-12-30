import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import * as moment from 'moment-timezone';

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
  AvailableTimeSlot,
  BaseSlotDto,
  BusinessConfigDto,
  GetTimeslotsQueryDto,
  OccupationByEmployeeDto,
  TimeslotResponseDto,
} from './dto/timeslots.dto';
import * as _ from 'lodash';

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
    { serviceId, startDate, days, timezoneOffset }: GetTimeslotsQueryDto,
  ): Promise<GenericResponse<{ [date: string]: TimeslotResponseDto }>> {
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
        service.measure,
        timezoneOffset,
      );

      const baseSlots = this.generateBaseSlots(moment(startDate), config, days);

      const availableSlotsByDate = this.getAvailableSlotsByEmployee(
        baseSlots,
        appointments,
        activeEmployees,
        days,
      );

      return new GenericResponse(availableSlotsByDate);
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
      .where('idBusiness')
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

    // Calculate end date: startDate + (days - 1) days
    const endDate = moment(startDate)
      .add(days - 1, 'days')
      .endOf('day');

    // Convert moment dates to timestamps (milliseconds) for DynamoDB queries
    const startTimestamp = startDate.startOf('day').valueOf();
    const endTimestamp = endDate.valueOf();

    // OPTIMIZACIÓN: Usar query con GSI idBusiness-index en lugar de scan
    const businessQuery = await this.appointmentModel
      .query('idBusiness')
      .using('idBusiness-index')
      .eq(businessId)
      .exec();

    // Filtrar por startDate (rango) e idEmployee en memoria
    const appointments = businessQuery
      .filter((apt) => {
        const aptStartDate = new Date(apt.startDate).getTime();
        const startDateMatch =
          aptStartDate >= startTimestamp && aptStartDate <= endTimestamp;
        const employeeMatch = employeeIds.includes(apt.idEmployee);
        return startDateMatch && employeeMatch;
      })
      .map((appt) => appt.toJSON() as Appointment);

    return appointments;
  }

  /**
   * Get business configuration (minHour, maxHour, splitTime)
   * TODO: This could be fetched from a domains/business config service
   * For now, using defaults or provided values
   */
  private async getBusinessConfig(
    businessId: string,
    serviceTime: number,
    timezoneOffset: number,
  ): Promise<BusinessConfigDto> {
    // Get timezone offset in minutes from getTimezoneOffset()
    // getTimezoneOffset() returns positive for timezones west of UTC (e.g., UTC-5 = 300)
    // Example: UTC-5 (Bogotá) = 300 minutes, UTC+5 = -300 minutes
    const minHour = '08:00';
    const maxHour = '18:00';

    const [parsedMinHour, parsedMinMinute] = minHour.split(':').map(Number);
    const [parsedMaxHour, parsedMaxMinute] = maxHour.split(':').map(Number);

    // Para convertir hora local a UTC:
    // Si minHour es "08:00" hora local y estamos en UTC-5 (Bogotá),
    // entonces 08:00 local = 08:00 + 5 horas = 13:00 UTC
    // getTimezoneOffset() devuelve 300 (positivo) para UTC-5,
    // así que debemos SUMAR para convertir local a UTC
    const newMinHour = moment
      .utc()
      .set({
        hour: parsedMinHour,
        minute: parsedMinMinute,
        second: 0,
        millisecond: 0,
      })
      .add(timezoneOffset, 'minutes'); // Convierte hora local a UTC

    const newMaxHour = moment
      .utc()
      .set({
        hour: parsedMaxHour,
        minute: parsedMaxMinute,
        second: 0,
        millisecond: 0,
      })
      .add(timezoneOffset, 'minutes'); // Convierte hora local a UTC

    return {
      minHour: newMinHour.format('HH:mm'),
      maxHour: newMaxHour.format('HH:mm'),
      splitTime: serviceTime + 5, // 5 minutes default
    };
  }

  /**
   * Fase A: Generate base slots (skeleton) for all days
   */
  private generateBaseSlots(
    startDate: moment.Moment,
    config: BusinessConfigDto,
    days: number,
  ): BaseSlotDto[] {
    const baseSlots: BaseSlotDto[] = [];

    // Parse minHour and maxHour
    const [minHour, minMinute] = config.minHour.split(':').map(Number);
    const [maxHour, maxMinute] = config.maxHour.split(':').map(Number);

    // Generate slots for each day
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const currentDate = moment(startDate)
        .add(dayOffset, 'days')
        .startOf('day');

      const dayStartTime = currentDate
        .clone()
        .set({ hour: minHour, minute: minMinute, second: 0, millisecond: 0 });
      const dayEndTime = currentDate
        .clone()
        .set({ hour: maxHour, minute: maxMinute, second: 0, millisecond: 0 });

      const slotStart = dayStartTime.clone();
      while (slotStart.isBefore(dayEndTime)) {
        const slotEnd = slotStart.clone().add(config.splitTime, 'minutes');

        // Only add slot if it doesn't exceed the end time
        if (slotEnd.isSameOrBefore(dayEndTime)) {
          baseSlots.push({
            start: slotStart.toDate(),
            end: slotEnd.toDate(),
          });
        }
        slotStart.add(config.splitTime, 'minutes');
      }
    }
    return baseSlots;
  }

  /**
   * Calculate occupation by employee and return the least occupied employee
   * @param appointments List of appointments for a specific date
   * @param activeEmployees List of active employees
   * @returns The least occupied employee (or null if no employees)
   */
  private calculateOccupationByEmployee(
    appointments: Appointment[],
    activeEmployees: User[],
  ): OccupationByEmployeeDto | null {
    if (activeEmployees.length === 0) {
      return null;
    }

    // Count appointments by employee using lodash
    const appointmentCounts = _.countBy(
      appointments,
      (appt) => appt.idEmployee,
    );

    // Create occupation array for all active employees (including those with 0 appointments)
    const occupationByEmployee: OccupationByEmployeeDto[] = activeEmployees
      .map((emp) => ({
        idEmployee: emp.id,
        times: appointmentCounts[emp.id] || 0,
      }))
      .sort((a, b) => a.times - b.times); // Sort by occupation (least occupied first)

    // Return the least occupied employee (first in sorted array)
    return occupationByEmployee.length > 0 ? occupationByEmployee[0] : null;
  }

  private getAvailableSlotsByEmployee(
    baseSlots: BaseSlotDto[],
    appointments: Appointment[],
    activeEmployees: User[],
    days: number,
  ): { [date: string]: TimeslotResponseDto } {
    // Group slots by date
    const slotsByDate = _.groupBy(baseSlots, (slot) =>
      moment(slot.start).format('YYYY-MM-DD'),
    );

    // Group appointments by date
    const appointmentsByDate = _.groupBy(appointments, (appt) =>
      moment(appt.startDate).format('YYYY-MM-DD'),
    );

    const result: { [date: string]: TimeslotResponseDto } = {};

    // Process each date
    Object.keys(slotsByDate).forEach((date) => {
      const dateSlots = slotsByDate[date];
      const dateAppointments = appointmentsByDate[date] || [];

      // Calculate occupation by employee using the new function (returns least occupied employee)
      const occupationByEmployee = this.calculateOccupationByEmployee(
        dateAppointments,
        activeEmployees,
      );

      // Si un timeslot está libre para algún empleado, lo incluimos con los empleados disponibles para ese slot
      const availableTimeslots: AvailableTimeSlot[] = dateSlots
        .map((slot) => {
          // Para cada slot, encuentra los empleados que no tienen un appointment que se superponga al slot
          const availableEmployeeIds = activeEmployees
            .filter((emp) => {
              const hasConflict = dateAppointments.some((appt) => {
                // Conflicto si el appointment es del empleado y se solapa con el slot
                if (appt.idEmployee !== emp.id) return false;
                return (
                  moment(slot.start).isBefore(appt.endDate) &&
                  moment(slot.end).isAfter(appt.startDate)
                );
              });
              return !hasConflict;
            })
            .map((emp) => emp.id);

          if (availableEmployeeIds.length > 0) {
            return {
              idEmployees: availableEmployeeIds,
              startTime: slot.start,
              endTime: slot.end,
            } as AvailableTimeSlot;
          }
          return null;
        })
        .filter(Boolean);

      result[date] = {
        occupationByEmployee,
        availableTimeslots,
      } as TimeslotResponseDto;
    });

    return result;
  }
}
