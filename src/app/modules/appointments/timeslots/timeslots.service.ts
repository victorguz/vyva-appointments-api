import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import * as moment from 'moment';
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
import { TimeslotResponseDto } from './dto/timeslots.dto';

interface BaseSlot {
  date: string; // ISO date string
  start: moment.Moment; // Moment object for start time
  end: moment.Moment; // Moment object for end time
  startISO: string; // ISO datetime string
  endISO: string; // ISO datetime string
}

interface BusinessConfig {
  minHour: string; // Format: 'HH:mm'
  maxHour: string; // Format: 'HH:mm'
  splitTime: number; // Minutes
}

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
    serviceId: string,
    options?: { startDate?: Date; days?: number },
  ): Promise<GenericResponse<TimeslotResponseDto[]>> {
    try {
      // Validate inputs
      if (!businessId) {
        throw new Error('MS014'); // BusinessInfoId is required
      }
      if (!serviceId) {
        throw new Error('MS014'); // ServiceId is required
      }

      const startDate = options?.startDate
        ? moment(options.startDate)
        : moment();
      const days = options?.days || 12;

      // Fase B: Get service, employees, and appointments
      const service = await this.getService(serviceId, businessId);
      const activeEmployees = await this.getActiveEmployees(businessId);
      const appointments = await this.getAppointments(
        businessId,
        startDate,
        days,
        activeEmployees,
      );

      // Get business configuration (defaults if not configured)
      const config = await this.getBusinessConfig(businessId);

      // Calculate slot duration
      const slotDuration = service.measure + config.splitTime;

      // Fase A: Generate base slots (skeleton)
      const baseSlots = this.generateBaseSlots(
        startDate,
        days,
        slotDuration,
        config,
      );

      // Fase C: Filter available slots
      const availableSlots = this.filterAvailableSlots(
        baseSlots,
        activeEmployees,
        appointments,
      );

      // Format response
      const response: TimeslotResponseDto[] = availableSlots.map((slot) => ({
        date: slot.date,
        start: slot.startISO,
        end: slot.endISO,
        availableEmployeeIds: slot.availableEmployeeIds,
      }));

      return new GenericResponse(response);
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
      throw new Error('MS007'); // Service not found
    }

    return products[0].toJSON() as Product;
  }

  /**
   * Get active employees for a business
   */
  private async getActiveEmployees(businessId: string): Promise<User[]> {
    const response = await this.usersService.findEmployees(businessId);
    if (!response.success || !response.data) {
      return [];
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

    const endDate = moment(startDate)
      .add(days - 1, 'days')
      .endOf('day');

    const appointments = await this.appointmentModel
      .scan()
      .where('businessInfoId')
      .eq(businessId)
      .where('startDate')
      .ge(startDate.toDate() as any)
      .where('startDate')
      .le(endDate.toDate() as any)
      .exec();

    // Filter by active employees and exclude canceled appointments
    return appointments
      .map((appt) => appt.toJSON() as Appointment)
      .filter(
        (appt) =>
          appt.idEmployee &&
          employeeIds.includes(appt.idEmployee) &&
          appt.status !== AppointmentStatus.canceled,
      );
  }

  /**
   * Get business configuration (minHour, maxHour, splitTime)
   * TODO: This could be fetched from a domains/business config service
   * For now, using defaults
   */
  private async getBusinessConfig(businessId: string): Promise<BusinessConfig> {
    // Default configuration
    // TODO: Fetch from domains or business config if available
    return {
      minHour: '08:00',
      maxHour: '18:00',
      splitTime: 5, // 5 minutes default
    };
  }

  /**
   * Fase A: Generate base slots (skeleton) for all days
   */
  private generateBaseSlots(
    startDate: moment.Moment,
    days: number,
    slotDuration: number,
    config: BusinessConfig,
  ): BaseSlot[] {
    const baseSlots: BaseSlot[] = [];

    // Parse minHour and maxHour
    const [minHour, minMinute] = config.minHour.split(':').map(Number);
    const [maxHour, maxMinute] = config.maxHour.split(':').map(Number);

    // Iterate through each day
    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const currentDate = moment(startDate)
        .add(dayOffset, 'days')
        .startOf('day');
      const dateISO = currentDate.format('YYYY-MM-DD');

      // Start from minHour
      let currentSlotStart = currentDate
        .clone()
        .set({ hour: minHour, minute: minMinute, second: 0, millisecond: 0 });
      const maxTime = currentDate
        .clone()
        .set({ hour: maxHour, minute: maxMinute, second: 0, millisecond: 0 });

      // Generate slots for this day
      while (currentSlotStart.isBefore(maxTime)) {
        const currentSlotEnd = currentSlotStart
          .clone()
          .add(slotDuration, 'minutes');

        // Stop if slot end exceeds maxHour
        if (currentSlotEnd.isAfter(maxTime)) {
          break;
        }

        baseSlots.push({
          date: dateISO,
          start: currentSlotStart.clone(),
          end: currentSlotEnd.clone(),
          startISO: currentSlotStart.toISOString(),
          endISO: currentSlotEnd.toISOString(),
        });

        // Next slot starts where this one ends
        currentSlotStart = currentSlotEnd.clone();
      }
    }

    return baseSlots;
  }

  /**
   * Fase C: Filter available slots using the alternative approach
   * Calculate occupied slots per employee and merge them
   */
  private filterAvailableSlots(
    baseSlots: BaseSlot[],
    activeEmployees: User[],
    appointments: Appointment[],
  ): Array<BaseSlot & { availableEmployeeIds: string[] }> {
    if (activeEmployees.length === 0) {
      // No employees, no available slots
      return [];
    }

    // Helper function to check overlap using moment's exact functions
    const isOverlapping = (
      slotStart: moment.Moment,
      slotEnd: moment.Moment,
      apptStart: Date | string,
      apptEnd: Date | string,
    ): boolean => {
      const apptStartMoment = moment(apptStart);
      const apptEndMoment = moment(apptEnd);

      // Overlap condition: slotStart < apptEnd && apptStart < slotEnd
      // Using isBefore for non-inclusive comparison (slots that touch exactly don't overlap)
      // For more exact comparison, we could use isSameOrBefore, but isBefore is correct for this use case
      return (
        slotStart.isBefore(apptEndMoment) && apptStartMoment.isBefore(slotEnd)
      );
    };

    // Calculate occupied slots by each employee
    const occupiedSlotsByEmployee = new Map<string, Set<string>>();

    activeEmployees.forEach((employee) => {
      const employeeAppointments = appointments.filter(
        (appt) => appt.idEmployee === employee.id,
      );
      const occupiedSlots = new Set<string>();

      employeeAppointments.forEach((appt) => {
        // Find all base slots that overlap with this appointment
        baseSlots.forEach((slot) => {
          if (
            isOverlapping(slot.start, slot.end, appt.startDate, appt.endDate)
          ) {
            const slotKey = `${slot.date}-${slot.startISO}-${slot.endISO}`;
            occupiedSlots.add(slotKey);
          }
        });
      });

      occupiedSlotsByEmployee.set(employee.id, occupiedSlots);
    });

    // Find slots that are occupied by ALL employees
    const fullyOccupiedSlots = new Set<string>();

    if (activeEmployees.length > 0 && baseSlots.length > 0) {
      // Check each base slot
      baseSlots.forEach((slot) => {
        const slotKey = `${slot.date}-${slot.startISO}-${slot.endISO}`;

        // Check if this slot is occupied in ALL employees
        const isOccupiedInAll = activeEmployees.every((emp) => {
          const empSlots = occupiedSlotsByEmployee.get(emp.id);
          return empSlots && empSlots.has(slotKey);
        });

        if (isOccupiedInAll) {
          fullyOccupiedSlots.add(slotKey);
        }
      });
    }

    // Filter available slots and determine which employees are available for each
    const availableSlots: Array<BaseSlot & { availableEmployeeIds: string[] }> =
      [];

    baseSlots.forEach((slot) => {
      const slotKey = `${slot.date}-${slot.startISO}-${slot.endISO}`;

      // Skip if fully occupied
      if (fullyOccupiedSlots.has(slotKey)) {
        return;
      }

      // Find which employees are available for this slot
      const availableEmployeeIds: string[] = [];

      activeEmployees.forEach((employee) => {
        const empSlots = occupiedSlotsByEmployee.get(employee.id);
        if (!empSlots || !empSlots.has(slotKey)) {
          // Employee is available for this slot
          availableEmployeeIds.push(employee.id);
        }
      });

      // Only include slots where at least one employee is available
      if (availableEmployeeIds.length > 0) {
        availableSlots.push({
          ...slot,
          availableEmployeeIds,
        });
      }
    });

    return availableSlots;
  }
}
