import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';
import * as moment from 'moment-timezone';

import { UsersService } from '../../users/users.service';
import { TimeslotsService } from './timeslots.service';

const chainableQuery = (rows: unknown[]) => {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['using', 'eq', 'where', 'ge', 'gt', 'le', 'lt', 'in', 'and', 'all']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.exec = jest.fn().mockResolvedValue(rows);
  return chain;
};

/**
 * Las horas que se ofrecen van seguidas: en cada tramo libre la primera sale en
 * cuanto se abre y las siguientes cada duración del servicio + tiempo entre
 * citas. Nada de una rejilla fija de 10 minutos.
 */
describe('TimeslotsService - horas seguidas por duración', () => {
  const businessId = 'business-1';
  // Colombia: hora local menos UTC
  const colombia = -300;
  // Lunes 2026-09-14 00:00 en Colombia
  const startDate = '2026-09-14T05:00:00.000Z';

  let services: Record<string, number>;
  let employees: Array<Record<string, unknown>>;
  let domainRows: { group: string; value: string }[];
  let appointmentRows: Record<string, unknown>[];

  const horario = (startTime: string, endTime: string) => ({
    group: 'activeTime',
    value: JSON.stringify({
      monday: { startTime, endTime },
      tuesday: { startTime, endTime },
    }),
  });
  const margen = (splitTime: number) => ({
    group: 'appointmentTimes',
    value: JSON.stringify({ splitTime, defaultTime: 90 }),
  });
  const almuerzo = (startTime: string, endTime: string) => ({
    group: 'lunchBreak',
    value: JSON.stringify({ enabled: true, startTime, endTime }),
  });
  /** Instante UTC para una hora de Colombia del 2026-09-DD. */
  const enColombia = (day: number, time: string) =>
    new Date(`2026-09-${String(day).padStart(2, '0')}T${time}:00.000-05:00`);
  const cita = (idEmployee: string, desde: string, hasta: string, status = 'confirmed') => ({
    id: `apt-${idEmployee}-${desde}`,
    idEmployee,
    status,
    startDate: enColombia(14, desde),
    endDate: enColombia(14, hasta),
  });

  const consultar = async (extra: Record<string, unknown> = {}) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeslotsService,
        {
          provide: UsersService,
          useValue: {
            findEmployees: jest.fn().mockResolvedValue({ success: true, data: employees }),
          },
        },
        {
          provide: getModelToken('Appointment'),
          useValue: { query: jest.fn(() => chainableQuery(appointmentRows)) },
        },
        {
          provide: getModelToken('Product'),
          useValue: {
            get: jest.fn(async ({ id }: { id: string }) => ({
              toJSON: () => ({ id, idBusiness: businessId, measure: services[id] }),
            })),
          },
        },
        {
          provide: getModelToken('Domain'),
          useValue: { query: jest.fn(() => chainableQuery(domainRows)) },
        },
      ],
    }).compile();

    const service = module.get<TimeslotsService>(TimeslotsService);
    const response = await service.getAvailableTimeslots(businessId, {
      serviceId: 'servicio-90',
      startDate,
      days: 1,
      timezoneOffset: colombia,
      ...extra,
    } as any);
    return response.data;
  };

  /** Horas de un día en el reloj de Colombia, con el empleado si se pide. */
  const horas = async (extra: Record<string, unknown> = {}, conEmpleado = false) => {
    const data = await consultar(extra);
    return (data['2026-09-14'] ?? []).map((slot) => {
      const hora = moment.utc(slot.startTime).add(colombia, 'minutes').format('HH:mm');
      return conEmpleado ? `${hora} ${slot.idEmployee}` : hora;
    });
  };

  beforeEach(() => {
    services = { 'servicio-90': 90, 'servicio-30': 30, 'servicio-60': 60 };
    employees = [{ id: 'emp-1', status: true }];
    appointmentRows = [];
    domainRows = [horario('12:00', '18:00')];
  });

  it('un servicio de 90 minutos ofrece 12:00, 13:30, 15:00 y 16:30', async () => {
    expect(await horas()).toEqual(['12:00', '13:30', '15:00', '16:30']);
  });

  it('cada hora dura lo que el servicio y ninguna se pisa con la siguiente', async () => {
    const data = await consultar();
    const slots = data['2026-09-14'];

    for (const slot of slots) {
      expect(slot.endTime.getTime() - slot.startTime.getTime()).toBe(90 * 60_000);
    }
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].startTime.getTime()).toBeGreaterThanOrEqual(slots[i - 1].endTime.getTime());
    }
  });

  it('tras una cita de 12:00 a 13:30, un servicio de 30 minutos empieza a las 13:30', async () => {
    appointmentRows.push(cita('emp-1', '12:00', '13:30'));

    const resultado = await horas({ serviceId: 'servicio-30' });

    expect(resultado[0]).toBe('13:30');
    expect(resultado.slice(0, 4)).toEqual(['13:30', '14:00', '14:30', '15:00']);
  });

  it('tras una cita que no cae en punto, la siguiente hora se pega a su final', async () => {
    appointmentRows.push(cita('emp-1', '12:00', '12:50'));

    expect(await horas()).toEqual(['12:50', '14:20', '15:50']);
  });

  it('antes de una cita solo ofrece las horas que terminan a tiempo', async () => {
    appointmentRows.push(cita('emp-1', '15:00', '16:00'));

    // 12:00-13:30 cabe; 13:30-15:00 termina justo al empezar la cita; después, 16:00-17:30.
    expect(await horas()).toEqual(['12:00', '13:30', '16:00']);
  });

  it('respeta el almuerzo y retoma en cuanto termina', async () => {
    domainRows = [horario('08:00', '18:00'), almuerzo('13:00', '14:00')];

    // 11:00-12:30 es la última de la mañana: 12:30-14:00 pisaría el almuerzo.
    expect(await horas()).toEqual(['08:00', '09:30', '11:00', '14:00', '15:30']);
  });

  describe('tiempo entre citas', () => {
    it('separa las horas ofrecidas: duración + margen', async () => {
      domainRows = [horario('08:00', '12:00'), margen(15)];

      expect(await horas({ serviceId: 'servicio-60' })).toEqual(['08:00', '09:15', '10:30']);
    });

    it('deja el margen antes y después de una cita ya puesta', async () => {
      domainRows = [horario('08:00', '13:00'), margen(15)];
      appointmentRows.push(cita('emp-1', '10:00', '11:00'));

      // 09:15-10:15 chocaría con el margen previo a las 10:00; después se retoma a las 11:15.
      expect(await horas({ serviceId: 'servicio-60' })).toEqual(['08:00', '11:15']);
    });

    it('no deja margen alrededor del almuerzo ni del cierre', async () => {
      domainRows = [horario('08:00', '13:00'), margen(15), almuerzo('10:00', '11:00')];

      // 08:00-09:00; tras el almuerzo se empieza a las 11:00 en punto. 12:15 no cabe antes del cierre.
      expect(await horas({ serviceId: 'servicio-60' })).toEqual(['08:00', '11:00']);
    });

    it('no deja margen alrededor de un tiempo fuera', async () => {
      domainRows = [horario('08:00', '12:00'), margen(15)];
      appointmentRows.push(cita('emp-1', '09:00', '10:00', 'timeOut'));

      // 08:00-09:00 termina justo al empezar el tiempo fuera y 10:00 empieza justo al acabar.
      // 11:15 (10:00 + 60 + 15) ya no cabe antes del cierre.
      expect(await horas({ serviceId: 'servicio-60' })).toEqual(['08:00', '10:00']);
    });

    it('grid=service se sigue aceptando y da lo mismo', async () => {
      domainRows = [horario('08:00', '12:00'), margen(10)];

      expect(await horas({ serviceId: 'servicio-60', grid: 'service' })).toEqual(
        await horas({ serviceId: 'servicio-60' }),
      );
    });
  });

  it('con varios servicios usa el más largo, como la reserva', async () => {
    expect(
      await horas({ serviceId: 'servicio-30', serviceIds: 'servicio-30,servicio-90' }),
    ).toEqual(['12:00', '13:30', '15:00', '16:30']);
  });

  it('con varios empleados, cada hora sigue el paso de quien la recibe', async () => {
    employees = [
      { id: 'emp-1', status: true },
      { id: 'emp-2', status: true },
    ];
    domainRows = [horario('12:00', '15:00')];
    appointmentRows.push(cita('emp-1', '12:00', '12:30'));

    expect(await horas({ serviceId: 'servicio-60' }, true)).toEqual([
      '12:00 emp-2',
      '12:30 emp-1',
      '13:00 emp-2',
      '13:30 emp-1',
      '14:00 emp-2',
    ]);
  });

  it('a igual hora entre empleados libres, la recibe el menos ocupado', async () => {
    employees = [
      { id: 'emp-1', status: true },
      { id: 'emp-2', status: true },
    ];
    domainRows = [horario('12:00', '18:00')];
    // emp-1 tiene una cita al final del día: está más ocupado, pero su mañana va igual que la de emp-2.
    appointmentRows.push(cita('emp-1', '16:30', '18:00'));

    expect(await horas({}, true)).toEqual([
      '12:00 emp-2',
      '13:30 emp-2',
      '15:00 emp-2',
      '16:30 emp-2',
    ]);
  });
});

/**
 * timezoneOffset es hora local MENOS UTC (Colombia = -300), el signo contrario
 * a Date.getTimezoneOffset(). El asistente y el MCP ya mandan -300.
 */
describe('TimeslotsService - desfase horario', () => {
  const businessId = 'business-1';

  const consultar = async (startDate: string, timezoneOffset: number, days = 1) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeslotsService,
        {
          provide: UsersService,
          useValue: {
            findEmployees: jest
              .fn()
              .mockResolvedValue({ success: true, data: [{ id: 'emp-1', status: true }] }),
          },
        },
        { provide: getModelToken('Appointment'), useValue: { query: jest.fn(() => chainableQuery([])) } },
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
          useValue: {
            query: jest.fn(() =>
              chainableQuery([
                {
                  group: 'activeTime',
                  value: JSON.stringify({ monday: { startTime: '08:00', endTime: '10:00' } }),
                },
              ]),
            ),
          },
        },
      ],
    }).compile();

    const response = await module.get<TimeslotsService>(TimeslotsService).getAvailableTimeslots(
      businessId,
      { serviceId: 'service-1', startDate, days, timezoneOffset } as any,
    );
    return Object.fromEntries(
      Object.entries(response.data).map(([date, slots]) => [
        date,
        slots.map((slot) => slot.startTime.toISOString()),
      ]),
    );
  };

  it('con -300 (Colombia) las 08:00 locales son las 13:00 UTC del mismo día', async () => {
    expect(await consultar('2026-09-14T05:00:00.000Z', -300)).toEqual({
      '2026-09-14': ['2026-09-14T13:00:00.000Z', '2026-09-14T14:00:00.000Z'],
    });
  });

  it('una consulta a las 23:30 del domingo en Colombia sigue contando el lunes como lunes', async () => {
    // 2026-09-14T04:30Z es domingo 13 a las 23:30 en Colombia.
    expect(await consultar('2026-09-14T04:30:00.000Z', -300, 2)).toEqual({
      '2026-09-14': ['2026-09-14T13:00:00.000Z', '2026-09-14T14:00:00.000Z'],
    });
  });

  it('con +60 (UTC+1) las 08:00 locales son las 07:00 UTC', async () => {
    expect(await consultar('2026-09-13T23:00:00.000Z', 60)).toEqual({
      '2026-09-14': ['2026-09-14T07:00:00.000Z', '2026-09-14T08:00:00.000Z'],
    });
  });

  it('con +300, lo que da getTimezoneOffset() en Colombia, las horas salen corridas 10 horas', async () => {
    // Por esto el navegador debe mandar -getTimezoneOffset(): con +300 el lunes
    // de las 08:00 cae a las 03:00 UTC, que en Colombia son las 22:00 del domingo.
    expect(await consultar('2026-09-14T05:00:00.000Z', 300)).toEqual({
      '2026-09-14': ['2026-09-14T03:00:00.000Z', '2026-09-14T04:00:00.000Z'],
    });
  });
});
