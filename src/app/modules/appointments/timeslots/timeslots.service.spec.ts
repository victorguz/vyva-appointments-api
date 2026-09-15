import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';
import * as moment from 'moment-timezone';

import { UsersService } from '../../users/users.service';
import { TimeslotsService } from './timeslots.service';

/** Encadenable para las queries de dynamoose: todo retorna el mismo objeto y exec resuelve `rows`. */
const chainableQuery = (rows: unknown[]) => {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['using', 'eq', 'where', 'ge', 'gt', 'le', 'lt', 'in', 'and', 'all']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.exec = jest.fn().mockResolvedValue(rows);
  return chain;
};

describe('TimeslotsService - tiempos fuera', () => {
  const businessId = 'business-1';
  // UTC-5: offset local-menos-UTC en minutos
  const timezoneOffset = -300;
  // Lunes 2026-09-14 00:00 hora local
  const startDate = '2026-09-14T05:00:00.000Z';

  let service: TimeslotsService;
  let domainRows: { group: string; value: string }[];
  let appointmentRows: Record<string, unknown>[];

  const recurringDomain = (events: unknown[]) => ({
    group: 'recurringTimeOuts',
    value: JSON.stringify({ events }),
  });

  const baseEvent = {
    id: 'evt-1',
    employeeIds: ['emp-1'],
    startTime: '09:00',
    endTime: '10:00',
    weekDays: ['monday'],
    startDate: '2026-09-01',
    endDate: null as string | null,
    excludedDates: [] as string[],
  };

  const localTimesByDate = async () => {
    const response = await service.getAvailableTimeslots(businessId, {
      serviceId: 'service-1',
      startDate,
      days: 2,
      timezoneOffset,
    } as any);

    return Object.fromEntries(
      Object.entries(response.data).map(([date, slots]) => [
        date,
        slots.map((slot) =>
          moment.utc(slot.startTime).add(timezoneOffset, 'minutes').format('HH:mm'),
        ),
      ]),
    );
  };

  /** Instante UTC para una hora local (UTC-5) de 2026-09-DD. */
  const localInstant = (day: number, time: string) =>
    new Date(`2026-09-${String(day).padStart(2, '0')}T${time}:00.000-05:00`);

  beforeEach(async () => {
    appointmentRows = [];
    domainRows = [
      {
        group: 'activeTime',
        value: JSON.stringify({
          monday: { startTime: '08:00', endTime: '12:00' },
          tuesday: { startTime: '08:00', endTime: '12:00' },
        }),
      },
    ];

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeslotsService,
        {
          provide: UsersService,
          useValue: {
            findEmployees: jest.fn().mockResolvedValue({
              success: true,
              data: [{ id: 'emp-1', status: true }],
            }),
          },
        },
        {
          provide: getModelToken('Appointment'),
          useValue: { query: jest.fn(() => chainableQuery(appointmentRows)) },
        },
        {
          provide: getModelToken('Product'),
          useValue: {
            get: jest.fn().mockResolvedValue({
              toJSON: () => ({ id: 'service-1', idBusiness: businessId, measure: 60 }),
            }),
          },
        },
        {
          provide: getModelToken('Domain'),
          useValue: { query: jest.fn(() => chainableQuery(domainRows)) },
        },
      ],
    }).compile();

    service = module.get<TimeslotsService>(TimeslotsService);
  });

  it('no ofrece horarios durante un tiempo fuera guardado como appointment', async () => {
    appointmentRows.push({
      id: 'apt-timeout',
      idEmployee: 'emp-1',
      status: 'timeOut',
      startDate: localInstant(14, '10:00'),
      endDate: localInstant(14, '11:00'),
    });

    const slots = await localTimesByDate();

    expect(slots['2026-09-14']).toEqual(['08:00', '09:00', '11:00']);
    expect(slots['2026-09-15']).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });

  it('bloquea un tiempo fuera de varios días que empezó antes del rango consultado', async () => {
    appointmentRows.push({
      id: 'apt-vacaciones',
      idEmployee: 'emp-1',
      status: 'timeOut',
      startDate: localInstant(10, '08:00'),
      endDate: localInstant(15, '09:00'),
    });

    const slots = await localTimesByDate();

    expect(slots['2026-09-14']).toBeUndefined();
    expect(slots['2026-09-15']).toEqual(['09:00', '10:00', '11:00']);
  });

  it('bloquea el horario del evento recurrente solo en los días de la semana configurados', async () => {
    domainRows.push(recurringDomain([baseEvent]));

    const slots = await localTimesByDate();

    expect(slots['2026-09-14']).toEqual(['08:00', '10:00', '11:00']);
    expect(slots['2026-09-15']).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });

  it('cada 2 semanas solo bloquea las semanas intercaladas', async () => {
    // Semana de inicio: lunes 31 ago → 7 sep libre, 14 sep bloqueado
    domainRows.push(
      recurringDomain([
        { ...baseEvent, startDate: '2026-09-02', weekDays: ['monday'], intervalWeeks: 2 },
        { ...baseEvent, id: 'evt-2', startDate: '2026-09-08', weekDays: ['tuesday'], intervalWeeks: 2 },
      ]),
    );

    const slots = await localTimesByDate();

    expect(slots['2026-09-14']).toEqual(['08:00', '10:00', '11:00']);
    expect(slots['2026-09-15']).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });

  it('no bloquea los días excluidos ni fuera de la vigencia', async () => {
    domainRows.push(
      recurringDomain([
        { ...baseEvent, excludedDates: ['2026-09-14'] },
        { ...baseEvent, id: 'evt-2', weekDays: ['tuesday'], endDate: '2026-09-14' },
        { ...baseEvent, id: 'evt-3', weekDays: ['tuesday'], startDate: '2026-09-16' },
      ]),
    );

    const slots = await localTimesByDate();

    expect(slots['2026-09-14']).toEqual(['08:00', '09:00', '10:00', '11:00']);
    expect(slots['2026-09-15']).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });

  it('ignora eventos de empleados que no están en el cálculo', async () => {
    domainRows.push(recurringDomain([{ ...baseEvent, employeeIds: ['emp-99'] }]));

    const slots = await localTimesByDate();

    expect(slots['2026-09-14']).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });

  it('descarta eventos mal formados sin romper la consulta', async () => {
    domainRows.push({ group: 'recurringTimeOuts', value: '{not json' });

    const slots = await localTimesByDate();

    expect(slots['2026-09-14']).toEqual(['08:00', '09:00', '10:00', '11:00']);
  });
});
