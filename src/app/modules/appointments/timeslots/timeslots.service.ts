import { AVAILABLE_APPOINTMENT_STATUSES_TO_GENERATE_TIMESLOTS } from './../../../core/constants/generic.constants';
import { AppointmentStatus } from '../../../core/constants/domain.constants';
import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import * as moment from 'moment-timezone';

import { GenericResponse } from '../../../core/interfaces/generic-response.interface';
import {
  Appointment,
  AppointmentKey,
} from '../../../schemas/appointment.schema';
import { Domain, DomainKey } from '../../../schemas/domain.schema';
import { Product, ProductKey } from '../../../schemas/product.schema';
import { User, UserKey } from '../../../schemas/user.schema';
import { UsersService } from '../../users/users.service';
import { AvailableTimeSlot, GetTimeslotsQueryDto } from './dto/timeslots.dto';
import { isEmpty } from 'class-validator';

/** Precomputed appointment window for fast conflict checks (no moment per comparison). */
interface BlockedInterval {
  startMs: number;
  endMs: number;
  bufferEndMs: number;
}

interface DaySchedule {
  startTime: string;
  endTime: string;
}

interface ActiveTimeConfig {
  [dayKey: string]: DaySchedule;
}

interface LunchBreakConfig {
  enabled: boolean;
  startTime: string;
  endTime: string;
}

/** Parsed value from domain group appointmentTimes: {"splitTime":5,"defaultTime":90} */
interface AppointmentTimesConfig {
  splitTime: number;
  defaultTime: number;
}

interface BusinessScheduleConfig {
  /** Actual service duration shown on the booking and stored on the appointment. */
  serviceMinutes: number;
  /** Gap after an appointment ends before the next slot may start (appointmentTimes.splitTime). */
  marginMinutes: number;
  /** Minutes between offered start times (= service duration, non-overlapping slots). */
  gridIntervalMinutes: number;
  activeTime: ActiveTimeConfig;
  lunchBreak: LunchBreakConfig | null;
}

const ISO_WEEKDAY_TO_KEY: Record<number, string> = {
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
  7: 'sunday',
};

const DEFAULT_ACTIVE_DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/** Safety cap to avoid heap exhaustion on misconfigured grid intervals. */
const MAX_DAYS_RANGE = 31;
const MAX_SLOTS_PER_DAY = 500;
const LUNCH_APPOINTMENT_ID_PREFIX = '__lunch__';

const ALLOWED_TIMESLOT_STATUSES = new Set<string>(
  AVAILABLE_APPOINTMENT_STATUSES_TO_GENERATE_TIMESLOTS,
);

@Injectable()
export class TimeslotsService {
  constructor(
    private readonly usersService: UsersService,
    @InjectModel('Appointment')
    private readonly appointmentModel: Model<Appointment, AppointmentKey>,
    @InjectModel('Product')
    private readonly productModel: Model<Product, ProductKey>,
    @InjectModel('Domain')
    private readonly domainModel: Model<Domain, DomainKey>,
  ) {}

  /**
   * Get available timeslots for the next N days
   */
  async getAvailableTimeslots(
    businessId: string,
    { serviceId, startDate, days, timezoneOffset }: GetTimeslotsQueryDto,
  ): Promise<GenericResponse<{ [date: string]: AvailableTimeSlot[] }>> {
    try {
      const offset = Number(timezoneOffset) || 0;
      const safeDays = Math.min(
        Math.max(1, Number(days) || 12),
        MAX_DAYS_RANGE,
      );
      const startUtc = moment.utc(startDate);

      const [service, activeEmployees, domainValues] = await Promise.all([
        this.getService(serviceId, businessId),
        this.getActiveEmployees(businessId),
        this.loadDomainValuesByBusiness(businessId),
      ]);
      const schedule = this.buildScheduleConfig(
        domainValues,
        service.measure,
      );
      const appointments = await this.getAppointments(
        businessId,
        startUtc,
        safeDays,
        activeEmployees,
        offset,
      );
      const appointmentsWithLunch = this.mergeLunchBreakAsAppointments(
        appointments,
        startUtc,
        safeDays,
        offset,
        schedule,
        activeEmployees,
      );

      const availableSlotsByDate = this.buildAvailableSlotsByDate(
        startUtc,
        schedule,
        safeDays,
        offset,
        appointmentsWithLunch,
        activeEmployees,
      );

      return new GenericResponse(availableSlotsByDate);
    } catch (error) {
      throw error;
    }
  }

  /** Calendar date (YYYY-MM-DD) in the client's timezone for a UTC instant. */
  private toClientDateKey(
    utcInstant: Date | moment.Moment,
    timezoneOffset: number,
  ): string {
    return moment
      .utc(utcInstant)
      .subtract(timezoneOffset, 'minutes')
      .format('YYYY-MM-DD');
  }

  /** UTC instant for local midnight at the start of a client calendar day. */
  private clientDayStartUtc(
    rangeStartUtc: moment.Moment,
    dayOffset: number,
    timezoneOffset: number,
  ): moment.Moment {
    return rangeStartUtc
      .clone()
      .subtract(timezoneOffset, 'minutes')
      .startOf('day')
      .add(dayOffset, 'days')
      .add(timezoneOffset, 'minutes');
  }

  /**
   * Get service by ID
   */
  private async getService(
    serviceId: string,
    businessId: string,
  ): Promise<Product> {
    const product = await this.productModel.get({ id: serviceId });
    if (!product) {
      throw new Error('No se encontró el servicio');
    }
    const json = product.toJSON() as Product;
    if (json.idBusiness !== businessId) {
      throw new Error('No se encontró el servicio');
    }
    return json;
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
    startDateUtc: moment.Moment,
    days: number,
    activeEmployees: User[],
    timezoneOffset: number,
  ): Promise<Appointment[]> {
    const employeeIdSet = new Set(activeEmployees.map((emp) => emp.id));
    if (employeeIdSet.size === 0) {
      return [];
    }

    const rangeStartUtc = this.clientDayStartUtc(
      startDateUtc,
      0,
      timezoneOffset,
    );
    const startTimestamp = rangeStartUtc.valueOf();
    const endTimestamp = rangeStartUtc.clone().add(days, 'days').valueOf() - 1;

    // OPTIMIZACIÓN: Usar query con GSI idBusiness-index en lugar de scan
    const appointments = await this.appointmentModel
      .query('idBusiness')
      .using('idBusiness-index')
      .eq(businessId)
      .where('startDate')
      .ge(startTimestamp)
      .and()
      .where('endDate')
      .le(endTimestamp)
      .and()
      .where('idEmployee')
      .in([...employeeIdSet])
      .and()
      .where('status')
      .in(AVAILABLE_APPOINTMENT_STATUSES_TO_GENERATE_TIMESLOTS)
      .exec();

    // Filtrar por startDate (rango) e idEmployee en memoria
    // const appointments = businessQuery
    //   .filter((apt) => {
    //     const aptStartDate = new Date(apt.startDate).getTime();
    //     const startDateMatch =
    //       aptStartDate >= startTimestamp && aptStartDate <= endTimestamp;
    //     const employeeMatch = employeeIds.includes(apt.idEmployee);
    //     return startDateMatch && employeeMatch;
    //   })
    //   .map((appt) => appt.toJSON() as Appointment);

    return (appointments ?? [])
      .map((appt) =>
        typeof (appt as { toJSON?: () => Appointment }).toJSON === 'function'
          ? (appt as { toJSON: () => Appointment }).toJSON()
          : (appt as Appointment),
      )
      .filter((apt) => {
        if (!apt.idEmployee || !employeeIdSet.has(apt.idEmployee)) {
          return false;
        }
        if (!apt.status || !ALLOWED_TIMESLOT_STATUSES.has(apt.status)) {
          return false;
        }
        const aptStart = new Date(apt.startDate).getTime();
        const aptEnd = new Date(apt.endDate).getTime();
        return aptEnd > startTimestamp && aptStart < endTimestamp;
      });
  }

  /** Single Dynamo query for all domain groups needed by timeslots. */
  private async loadDomainValuesByBusiness(
    businessId: string,
  ): Promise<Map<string, string>> {
    const domains = await this.domainModel
      .query('idBusiness')
      .eq(businessId)
      .using('domain-idBusiness-index')
      .exec();

    const values = new Map<string, string>();
    for (const row of domains ?? []) {
      const group = row.group as string | undefined;
      const value = row.value as string | undefined;
      if (group && value && !isEmpty(value)) {
        values.set(group, value);
      }
    }
    return values;
  }

  /**
   * Parses appointmentTimes: {"splitTime":5,"defaultTime":90}
   */
  private parseAppointmentTimesConfig(
    raw: string | undefined,
  ): AppointmentTimesConfig {
    let value: { splitTime?: number; defaultTime?: number };

    if (!raw) {
      return { splitTime: 0, defaultTime: 90 };
    }

    try {
      value = JSON.parse(raw);
    } catch {
      value = { splitTime: 0, defaultTime: 90 };
    }

    if (typeof value.splitTime !== 'number' || value.splitTime < 0) {
      value.splitTime = 0;
    }
    if (typeof value.defaultTime !== 'number' || value.defaultTime <= 0) {
      value.defaultTime = 90;
    }

    return {
      splitTime: value.splitTime,
      defaultTime: value.defaultTime,
    };
  }

  private getDefaultActiveTime(): ActiveTimeConfig {
    const schedule: ActiveTimeConfig = {};
    for (const day of DEFAULT_ACTIVE_DAYS) {
      schedule[day] = { startTime: '08:00', endTime: '18:00' };
    }
    return schedule;
  }

  private parseActiveTimeConfig(raw: string | null): ActiveTimeConfig {
    if (!raw) return this.getDefaultActiveTime();
    try {
      const parsed = JSON.parse(raw) as ActiveTimeConfig;
      if (!parsed || typeof parsed !== 'object') {
        return this.getDefaultActiveTime();
      }
      return parsed;
    } catch {
      return this.getDefaultActiveTime();
    }
  }

  private parseLunchBreakConfig(raw: string | null): LunchBreakConfig | null {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as LunchBreakConfig;
      if (!parsed?.startTime || !parsed?.endTime) return null;
      return {
        enabled: parsed.enabled !== false,
        startTime: parsed.startTime,
        endTime: parsed.endTime,
      };
    } catch {
      return null;
    }
  }

  private buildScheduleConfig(
    domainValues: Map<string, string>,
    serviceTime: number,
  ): BusinessScheduleConfig {
    const appointmentTimes = this.parseAppointmentTimesConfig(
      domainValues.get('appointmentTimes'),
    );
    const serviceMinutes =
      serviceTime > 0 ? serviceTime : appointmentTimes.defaultTime;
    const marginMinutes = appointmentTimes.splitTime;
    const gridIntervalMinutes =
      marginMinutes > 0
        ? Math.min(marginMinutes, serviceMinutes)
        : serviceMinutes;

    return {
      serviceMinutes,
      marginMinutes,
      gridIntervalMinutes,
      activeTime: this.parseActiveTimeConfig(domainValues.get('activeTime') ?? null),
      lunchBreak: this.parseLunchBreakConfig(domainValues.get('lunchBreak') ?? null),
    };
  }

  private buildBlockedIntervalsByEmployee(
    appointments: Appointment[],
    marginMinutes: number,
  ): Map<string, BlockedInterval[]> {
    const marginMs = marginMinutes * 60_000;
    const byEmployee = new Map<string, BlockedInterval[]>();

    for (const appt of appointments) {
      if (!appt.idEmployee) continue;
      const startMs = moment.utc(appt.startDate).startOf('minute').valueOf();
      const endMs = moment.utc(appt.endDate).startOf('minute').valueOf();
      const interval: BlockedInterval = {
        startMs,
        endMs,
        bufferEndMs: endMs + marginMs,
      };
      const list = byEmployee.get(appt.idEmployee);
      if (list) {
        list.push(interval);
      } else {
        byEmployee.set(appt.idEmployee, [interval]);
      }
    }
    return byEmployee;
  }

  private filterBlocksOverlappingDay(
    blocks: BlockedInterval[],
    dayStartMs: number,
    dayEndMs: number,
  ): BlockedInterval[] {
    const overlapping: BlockedInterval[] = [];
    for (const block of blocks) {
      if (block.endMs > dayStartMs && block.startMs < dayEndMs) {
        overlapping.push(block);
      }
    }
    return overlapping;
  }

  private slotConflictsWithBlocks(
    slotStartMs: number,
    slotEndMs: number,
    blocks: BlockedInterval[],
    marginMinutes: number,
  ): boolean {
    for (const block of blocks) {
      if (slotStartMs < block.endMs && slotEndMs > block.startMs) {
        return true;
      }
      if (
        marginMinutes > 0 &&
        slotStartMs > block.endMs &&
        slotStartMs < block.bufferEndMs
      ) {
        return true;
      }
    }
    return false;
  }

  private getClientWeekdayKey(
    clientMidnightUtc: moment.Moment,
    timezoneOffset: number,
  ): string {
    const isoWeekday = moment
      .utc(clientMidnightUtc)
      .subtract(timezoneOffset, 'minutes')
      .isoWeekday();
    return ISO_WEEKDAY_TO_KEY[isoWeekday] ?? 'monday';
  }

  private parseTimeToMinutes(time: string): number {
    const [hour, minute] = time.split(':').map(Number);
    return hour * 60 + (minute || 0);
  }

  /**
   * Injects one synthetic appointment per employee per working day for lunchBreak,
   * so conflict detection treats lunch like any other blocked window.
   */
  private buildLunchBreakAppointments(
    startDateUtc: moment.Moment,
    days: number,
    timezoneOffset: number,
    lunchBreak: LunchBreakConfig,
    activeTime: ActiveTimeConfig,
    activeEmployees: User[],
  ): Appointment[] {
    const lunchAppointments: Appointment[] = [];

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const clientMidnightUtc = this.clientDayStartUtc(
        startDateUtc,
        dayOffset,
        timezoneOffset,
      );
      const weekdayKey = this.getClientWeekdayKey(
        clientMidnightUtc,
        timezoneOffset,
      );
      if (
        !activeTime[weekdayKey]?.startTime ||
        !activeTime[weekdayKey]?.endTime
      ) {
        continue;
      }

      const dateKey = this.toClientDateKey(clientMidnightUtc, timezoneOffset);
      const lunchStart = clientMidnightUtc
        .clone()
        .add(this.parseTimeToMinutes(lunchBreak.startTime), 'minutes');
      const lunchEnd = clientMidnightUtc
        .clone()
        .add(this.parseTimeToMinutes(lunchBreak.endTime), 'minutes');

      for (const employee of activeEmployees) {
        lunchAppointments.push({
          id: `${LUNCH_APPOINTMENT_ID_PREFIX}${employee.id}_${dateKey}`,
          startDate: lunchStart.toDate(),
          endDate: lunchEnd.toDate(),
          idEmployee: employee.id,
          status: AppointmentStatus.confirmed,
        } as Appointment);
      }
    }

    return lunchAppointments;
  }

  private mergeLunchBreakAsAppointments(
    appointments: Appointment[],
    startDateUtc: moment.Moment,
    days: number,
    timezoneOffset: number,
    schedule: BusinessScheduleConfig,
    activeEmployees: User[],
  ): Appointment[] {
    if (!schedule.lunchBreak?.enabled) {
      return appointments;
    }

    return [
      ...appointments,
      ...this.buildLunchBreakAppointments(
        startDateUtc,
        days,
        timezoneOffset,
        schedule.lunchBreak,
        schedule.activeTime,
        activeEmployees,
      ),
    ];
  }

  private isLunchSyntheticAppointment(appt: Appointment): boolean {
    return appt.id?.startsWith(LUNCH_APPOINTMENT_ID_PREFIX) ?? false;
  }

  /**
   * Builds available slots per date in one pass (no huge intermediate arrays).
   */
  private buildAvailableSlotsByDate(
    startDateUtc: moment.Moment,
    schedule: BusinessScheduleConfig,
    days: number,
    timezoneOffset: number,
    appointments: Appointment[],
    activeEmployees: User[],
  ): { [date: string]: AvailableTimeSlot[] } {
    const result: { [date: string]: AvailableTimeSlot[] } = {};
    const blockedByEmployee = this.buildBlockedIntervalsByEmployee(
      appointments,
      schedule.marginMinutes,
    );
    const appointmentsByDate = new Map<string, Appointment[]>();
    for (const appt of appointments) {
      const dateKey = this.toClientDateKey(appt.startDate, timezoneOffset);
      const list = appointmentsByDate.get(dateKey);
      if (list) {
        list.push(appt);
      } else {
        appointmentsByDate.set(dateKey, [appt]);
      }
    }

    const gridStep = schedule.gridIntervalMinutes;
    const serviceMs = schedule.serviceMinutes * 60_000;
    const employeeIds = activeEmployees.map((e) => e.id);

    for (let dayOffset = 0; dayOffset < days; dayOffset++) {
      const clientMidnightUtc = this.clientDayStartUtc(
        startDateUtc,
        dayOffset,
        timezoneOffset,
      );
      const dateKey = this.toClientDateKey(clientMidnightUtc, timezoneOffset);
      const weekdayKey = this.getClientWeekdayKey(
        clientMidnightUtc,
        timezoneOffset,
      );
      const daySchedule = schedule.activeTime[weekdayKey];

      if (!daySchedule?.startTime || !daySchedule?.endTime) {
        continue;
      }

      const dayStartTime = clientMidnightUtc
        .clone()
        .add(this.parseTimeToMinutes(daySchedule.startTime), 'minutes');
      const dayEndTime = clientMidnightUtc
        .clone()
        .add(this.parseTimeToMinutes(daySchedule.endTime), 'minutes');

      const dayAppointments = appointmentsByDate.get(dateKey) ?? [];
      const countMap = this.buildAppointmentCountMap(
        dayAppointments,
        activeEmployees,
      );
      const daySlots: AvailableTimeSlot[] = [];
      let slotsGenerated = 0;

      const dayEndMs = dayEndTime.valueOf();
      const dayStartMs = dayStartTime.valueOf();
      const gridStepMs = gridStep * 60_000;
      const dayBlocksByEmployee = new Map<string, BlockedInterval[]>();
      for (const empId of employeeIds) {
        dayBlocksByEmployee.set(
          empId,
          this.filterBlocksOverlappingDay(
            blockedByEmployee.get(empId) ?? [],
            dayStartMs,
            dayEndMs,
          ),
        );
      }

      let slotStartMs = dayStartMs;

      while (slotStartMs < dayEndMs && slotsGenerated < MAX_SLOTS_PER_DAY) {
        const slotEndMs = slotStartMs + serviceMs;
        if (slotEndMs > dayEndMs) {
          break;
        }

        let pickedEmployee: string | null = null;
        let pickedCount = Number.MAX_SAFE_INTEGER;

        for (const empId of employeeIds) {
          const blocks = dayBlocksByEmployee.get(empId) ?? [];
          if (
            this.slotConflictsWithBlocks(
              slotStartMs,
              slotEndMs,
              blocks,
              schedule.marginMinutes,
            )
          ) {
            continue;
          }
          const count = countMap.get(empId) ?? 0;
          if (count < pickedCount) {
            pickedCount = count;
            pickedEmployee = empId;
          }
        }

        if (pickedEmployee) {
          daySlots.push({
            idEmployee: pickedEmployee,
            startTime: new Date(slotStartMs),
            endTime: new Date(slotEndMs),
          });
          slotsGenerated++;
        }

        slotStartMs += gridStepMs;
      }

      if (daySlots.length > 0) {
        result[dateKey] = daySlots;
      }
    }

    return result;
  }

  /**
   * Build a map of appointment counts per employee for a given set of appointments.
   */
  private buildAppointmentCountMap(
    appointments: Appointment[],
    activeEmployees: User[],
  ): Map<string, number> {
    const countMap = new Map<string, number>();
    for (const emp of activeEmployees) {
      countMap.set(emp.id, 0);
    }
    for (const appt of appointments) {
      if (this.isLunchSyntheticAppointment(appt) || !appt.idEmployee) {
        continue;
      }
      countMap.set(appt.idEmployee, (countMap.get(appt.idEmployee) ?? 0) + 1);
    }
    return countMap;
  }
}
