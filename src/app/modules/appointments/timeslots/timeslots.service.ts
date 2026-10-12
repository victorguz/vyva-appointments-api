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
  /**
   * Cita de un cliente. Solo alrededor de estas se deja el tiempo entre citas:
   * el almuerzo y los tiempos fuera no piden preparar el espacio.
   */
  isBooking: boolean;
}

/** Tramo libre de un empleado dentro de su horario del día. */
interface FreeWindow {
  startMs: number;
  endMs: number;
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

/**
 * Evento del dominio recurringTimeOuts (lo gestiona vyva-frontend).
 * Horas y fechas son de reloj local del negocio, igual que lunchBreak.
 */
interface RecurringTimeOutEvent {
  id: string;
  employeeIds: string[];
  /** HH:mm */
  startTime: string;
  /** HH:mm */
  endTime: string;
  /** monday ... sunday (mismas claves que activeTime) */
  weekDays: string[];
  /** Cada cuántas semanas (1 = todas, 2 = intercaladas), contadas desde la semana de startDate */
  intervalWeeks?: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD, null = sin fin */
  endDate?: string | null;
  /** YYYY-MM-DD */
  excludedDates?: string[];
}

/** Parsed value from domain group appointmentTimes: {"splitTime":5,"defaultTime":90} */
interface AppointmentTimesConfig {
  splitTime: number;
  defaultTime: number;
}

interface BusinessScheduleConfig {
  /** Actual service duration shown on the booking and stored on the appointment. */
  serviceMinutes: number;
  /**
   * Tiempo entre citas (appointmentTimes.splitTime): minutos libres que quedan
   * entre dos citas de clientes del mismo empleado, antes y después de cada una.
   * También separa las horas que se ofrecen: cada una empieza duración + este
   * tiempo después de la anterior.
   */
  marginMinutes: number;
  activeTime: ActiveTimeConfig;
  lunchBreak: LunchBreakConfig | null;
  recurringTimeOuts: RecurringTimeOutEvent[];
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
const RECURRING_TIME_OUT_APPOINTMENT_ID_PREFIX = '__recurring_timeout__';
const TIME_OF_DAY_PATTERN = /^\d{1,2}:\d{2}$/;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
    {
      serviceId,
      serviceIds,
      employeeId,
      startDate,
      days,
      timezoneOffset,
    }: GetTimeslotsQueryDto,
  ): Promise<GenericResponse<{ [date: string]: AvailableTimeSlot[] }>> {
    try {
      const offset = Number(timezoneOffset) || 0;
      const safeDays = Math.min(
        Math.max(1, Number(days) || 12),
        MAX_DAYS_RANGE,
      );
      const startUtc = moment.utc(startDate);

      const requestedServiceIds = [
        ...new Set(
          (serviceIds?.split(',') ?? [serviceId])
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];
      const [services, allActiveEmployees, domainValues] = await Promise.all([
        Promise.all(
          requestedServiceIds.map((id) => this.getService(id, businessId)),
        ),
        this.getActiveEmployees(businessId),
        this.loadDomainValuesByBusiness(businessId),
      ]);
      const activeEmployees = employeeId
        ? allActiveEmployees.filter((employee) => employee.id === employeeId)
        : allActiveEmployees;
      if (activeEmployees.length === 0) {
        return new GenericResponse({});
      }
      const serviceMinutes = Math.max(
        ...services.map((service) => Number(service.measure) || 60),
      );
      const schedule = this.buildScheduleConfig(domainValues, serviceMinutes);
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
      const appointmentsWithTimeOuts = this.mergeRecurringTimeOutsAsAppointments(
        appointmentsWithLunch,
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
        appointmentsWithTimeOuts,
        activeEmployees,
      );

      return new GenericResponse(availableSlotsByDate);
    } catch (error) {
      throw error;
    }
  }

  /**
   * Calendar date (YYYY-MM-DD) in the client's timezone for a UTC instant.
   * timezoneOffset is local-minus-UTC in minutes (e.g. -300 for UTC-5), so
   * converting UTC -> local wall-clock time means ADDING it.
   */
  private toClientDateKey(
    utcInstant: Date | moment.Moment,
    timezoneOffset: number,
  ): string {
    return moment
      .utc(utcInstant)
      .add(timezoneOffset, 'minutes')
      .format('YYYY-MM-DD');
  }

  /**
   * UTC instant for local midnight at the start of a client calendar day.
   * timezoneOffset is local-minus-UTC in minutes: ADD it to go UTC -> local
   * wall-clock (floor to local midnight there), then SUBTRACT it to convert
   * that local midnight back to a real UTC instant.
   */
  private clientDayStartUtc(
    rangeStartUtc: moment.Moment,
    dayOffset: number,
    timezoneOffset: number,
  ): moment.Moment {
    return rangeStartUtc
      .clone()
      .add(timezoneOffset, 'minutes')
      .startOf('day')
      .add(dayOffset, 'days')
      .subtract(timezoneOffset, 'minutes');
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
    // Solo los activos que reciben citas: una lista de espera (showInPublicCalendars
    // en false) no es una persona y no ofrece horas. Sin el campo (empleados
    // anteriores) se asume que sí.
    return response.data.filter(
      (employee: User) =>
        employee.status === true && employee.showInPublicCalendars !== false,
    );
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

    // OPTIMIZACIÓN: Usar query con GSI idBusiness-index en lugar de scan.
    // Filtro por solapamiento (no por contención) para no perder bloqueos que
    // empiezan antes o terminan después del rango, p. ej. un tiempo fuera de varios días.
    const appointments = await this.appointmentModel
      .query('idBusiness')
      .using('idBusiness-index')
      .eq(businessId)
      .where('startDate')
      .le(endTimestamp)
      .and()
      .where('endDate')
      .gt(startTimestamp)
      .and()
      .where('idEmployee')
      .in([...employeeIdSet])
      .and()
      .where('status')
      .in(AVAILABLE_APPOINTMENT_STATUSES_TO_GENERATE_TIMESLOTS)
      .all()
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
      .all()
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

    return {
      serviceMinutes,
      marginMinutes: appointmentTimes.splitTime,
      activeTime: this.parseActiveTimeConfig(domainValues.get('activeTime') ?? null),
      lunchBreak: this.parseLunchBreakConfig(domainValues.get('lunchBreak') ?? null),
      recurringTimeOuts: this.parseRecurringTimeOuts(
        domainValues.get('recurringTimeOuts') ?? null,
      ),
    };
  }

  /**
   * Parses recurringTimeOuts: {"events":[{id, employeeIds, startTime, endTime, weekDays, startDate, endDate, excludedDates}]}
   * Descarta eventos mal formados en lugar de fallar toda la consulta.
   */
  private parseRecurringTimeOuts(raw: string | null): RecurringTimeOutEvent[] {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as { events?: RecurringTimeOutEvent[] };
      if (!Array.isArray(parsed?.events)) return [];

      return parsed.events.filter(
        (event) =>
          !!event?.id &&
          Array.isArray(event.employeeIds) &&
          Array.isArray(event.weekDays) &&
          TIME_OF_DAY_PATTERN.test(event.startTime ?? '') &&
          TIME_OF_DAY_PATTERN.test(event.endTime ?? '') &&
          this.parseTimeToMinutes(event.endTime) >
            this.parseTimeToMinutes(event.startTime) &&
          DATE_KEY_PATTERN.test(event.startDate ?? '') &&
          (!event.endDate || DATE_KEY_PATTERN.test(event.endDate)),
      );
    } catch {
      return [];
    }
  }

  private buildBlockedIntervalsByEmployee(
    appointments: Appointment[],
  ): Map<string, BlockedInterval[]> {
    const byEmployee = new Map<string, BlockedInterval[]>();

    for (const appt of appointments) {
      if (!appt.idEmployee) continue;
      const startMs = moment.utc(appt.startDate).startOf('minute').valueOf();
      const endMs = moment.utc(appt.endDate).startOf('minute').valueOf();
      const interval: BlockedInterval = {
        startMs,
        endMs,
        isBooking: !this.isNonBookingAppointment(appt),
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

  /**
   * Tramos libres de un empleado entre la apertura y el cierre del día.
   *
   * Cada cita de cliente ocupa además el tiempo entre citas antes y después
   * (para preparar el espacio); el almuerzo y los tiempos fuera ocupan solo su
   * horario. Al cierre no hace falta dejar margen.
   */
  private buildFreeWindows(
    dayStartMs: number,
    dayEndMs: number,
    blocks: BlockedInterval[],
    marginMs: number,
  ): FreeWindow[] {
    const busy = blocks
      .map((block) =>
        block.isBooking
          ? { startMs: block.startMs - marginMs, endMs: block.endMs + marginMs }
          : { startMs: block.startMs, endMs: block.endMs },
      )
      .sort((a, b) => a.startMs - b.startMs);

    const windows: FreeWindow[] = [];
    let cursor = dayStartMs;
    for (const block of busy) {
      if (block.startMs >= dayEndMs) break;
      if (block.endMs <= cursor) continue;
      if (block.startMs > cursor) {
        windows.push({ startMs: cursor, endMs: block.startMs });
      }
      cursor = block.endMs;
      if (cursor >= dayEndMs) break;
    }
    if (cursor < dayEndMs) {
      windows.push({ startMs: cursor, endMs: dayEndMs });
    }
    return windows;
  }

  /**
   * Horas de inicio que se ofrecen dentro de cada tramo libre: la primera en
   * cuanto se abre el tramo (la apertura, el fin del almuerzo o el fin de la
   * cita anterior más el margen) y las siguientes cada duración + margen, para
   * que las citas queden seguidas sin huecos que nadie pueda usar.
   */
  private packStartsInWindows(
    windows: FreeWindow[],
    serviceMs: number,
    stepMs: number,
  ): number[] {
    const starts: number[] = [];
    for (const window of windows) {
      for (
        let startMs = window.startMs;
        startMs + serviceMs <= window.endMs && starts.length < MAX_SLOTS_PER_DAY;
        startMs += stepMs
      ) {
        starts.push(startMs);
      }
    }
    return starts;
  }

  private getClientWeekdayKey(
    clientMidnightUtc: moment.Moment,
    timezoneOffset: number,
  ): string {
    const isoWeekday = moment
      .utc(clientMidnightUtc)
      .add(timezoneOffset, 'minutes')
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

  /**
   * Injects one synthetic appointment per employee for each day a recurring
   * time-out applies, so conflict detection treats it like a stored timeOut
   * (same approach as lunchBreak).
   */
  private buildRecurringTimeOutAppointments(
    startDateUtc: moment.Moment,
    days: number,
    timezoneOffset: number,
    events: RecurringTimeOutEvent[],
    activeEmployees: User[],
  ): Appointment[] {
    const activeEmployeeIds = new Set(activeEmployees.map((emp) => emp.id));
    const timeOutAppointments: Appointment[] = [];

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

      for (const event of events) {
        if (
          dateKey < event.startDate ||
          (event.endDate && dateKey > event.endDate) ||
          event.excludedDates?.includes(dateKey) ||
          !event.weekDays.includes(weekdayKey) ||
          !this.isRecurringWeekActive(event, dateKey)
        ) {
          continue;
        }

        const startDate = clientMidnightUtc
          .clone()
          .add(this.parseTimeToMinutes(event.startTime), 'minutes')
          .toDate();
        const endDate = clientMidnightUtc
          .clone()
          .add(this.parseTimeToMinutes(event.endTime), 'minutes')
          .toDate();

        for (const employeeId of event.employeeIds) {
          if (!activeEmployeeIds.has(employeeId)) continue;
          timeOutAppointments.push({
            id: `${RECURRING_TIME_OUT_APPOINTMENT_ID_PREFIX}${event.id}_${employeeId}_${dateKey}`,
            startDate,
            endDate,
            idEmployee: employeeId,
            status: AppointmentStatus.timeOut,
          } as Appointment);
        }
      }
    }

    return timeOutAppointments;
  }

  /**
   * Semanas intercaladas: la semana ISO de dateKey debe estar a un múltiplo de
   * intervalWeeks de la semana de startDate. Mismo cálculo que vyva-frontend
   * (recurring-time-out.utils), en UTC sobre claves YYYY-MM-DD.
   */
  private isRecurringWeekActive(
    event: RecurringTimeOutEvent,
    dateKey: string,
  ): boolean {
    const interval = Math.max(1, Math.floor(Number(event.intervalWeeks) || 1));
    if (interval === 1) return true;

    const weeksSinceStart = moment
      .utc(dateKey, 'YYYY-MM-DD')
      .startOf('isoWeek')
      .diff(
        moment.utc(event.startDate, 'YYYY-MM-DD').startOf('isoWeek'),
        'weeks',
      );

    return weeksSinceStart >= 0 && weeksSinceStart % interval === 0;
  }

  private mergeRecurringTimeOutsAsAppointments(
    appointments: Appointment[],
    startDateUtc: moment.Moment,
    days: number,
    timezoneOffset: number,
    schedule: BusinessScheduleConfig,
    activeEmployees: User[],
  ): Appointment[] {
    if (!schedule.recurringTimeOuts.length) {
      return appointments;
    }

    return [
      ...appointments,
      ...this.buildRecurringTimeOutAppointments(
        startDateUtc,
        days,
        timezoneOffset,
        schedule.recurringTimeOuts,
        activeEmployees,
      ),
    ];
  }

  /**
   * Lunch and time-outs (stored or recurring) block the agenda but are not
   * bookings, so they must not skew the per-employee load balancing.
   */
  private isNonBookingAppointment(appt: Appointment): boolean {
    return (
      appt.status === AppointmentStatus.timeOut ||
      ((appt.id?.startsWith(LUNCH_APPOINTMENT_ID_PREFIX) ||
        appt.id?.startsWith(RECURRING_TIME_OUT_APPOINTMENT_ID_PREFIX)) ??
        false)
    );
  }

  /**
   * Horas libres por día.
   *
   * No hay una rejilla fija: cada empleado tiene sus tramos libres del día (su
   * horario menos citas, almuerzo y tiempos fuera) y en cada tramo se ofrece la
   * primera hora en cuanto se abre y luego una cada duración + tiempo entre
   * citas. Un servicio de 90 minutos en un día libre da 12:00, 13:30, 15:00...
   * y, tras una cita que acaba a las 13:30, la siguiente hora es 13:30 (más el
   * margen, si lo hay). Cada hora se asigna al empleado menos ocupado entre
   * aquellos a los que les cae justo en su paso, para no dejarles huecos.
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
    const blockedByEmployee = this.buildBlockedIntervalsByEmployee(appointments);
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

    const serviceMs = schedule.serviceMinutes * 60_000;
    const marginMs = schedule.marginMinutes * 60_000;
    const stepMs = serviceMs + marginMs;
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
      const dayEndMs = dayEndTime.valueOf();
      const dayStartMs = dayStartTime.valueOf();

      // Hora de inicio -> empleados a los que les cae en su paso, en el orden
      // de la lista (a igual carga gana el primero, como antes).
      const employeesByStart = new Map<number, string[]>();
      for (const empId of employeeIds) {
        const windows = this.buildFreeWindows(
          dayStartMs,
          dayEndMs,
          this.filterBlocksOverlappingDay(
            blockedByEmployee.get(empId) ?? [],
            dayStartMs,
            dayEndMs,
          ),
          marginMs,
        );
        for (const startMs of this.packStartsInWindows(
          windows,
          serviceMs,
          stepMs,
        )) {
          const list = employeesByStart.get(startMs);
          if (list) {
            list.push(empId);
          } else {
            employeesByStart.set(startMs, [empId]);
          }
        }
      }

      const daySlots: AvailableTimeSlot[] = [...employeesByStart.keys()]
        .sort((a, b) => a - b)
        .slice(0, MAX_SLOTS_PER_DAY)
        .map((startMs) => {
          let pickedEmployee = '';
          let pickedCount = Number.MAX_SAFE_INTEGER;
          for (const empId of employeesByStart.get(startMs) ?? []) {
            const count = countMap.get(empId) ?? 0;
            if (count < pickedCount) {
              pickedCount = count;
              pickedEmployee = empId;
            }
          }
          return {
            idEmployee: pickedEmployee,
            startTime: new Date(startMs),
            endTime: new Date(startMs + serviceMs),
          };
        });

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
      if (this.isNonBookingAppointment(appt) || !appt.idEmployee) {
        continue;
      }
      countMap.set(appt.idEmployee, (countMap.get(appt.idEmployee) ?? 0) + 1);
    }
    return countMap;
  }
}
