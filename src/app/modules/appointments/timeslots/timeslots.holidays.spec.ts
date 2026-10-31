import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';
import * as moment from 'moment-timezone';

import { UsersService } from '../../users/users.service';
import { OfficialHolidaysService } from './official-holidays.service';
import { TimeslotsService } from './timeslots.service';

const chainableQuery = (rows: unknown[]) => {
  const chain: Record<string, jest.Mock> = {};
  for (const method of ['using', 'eq', 'where', 'ge', 'gt', 'le', 'lt', 'in', 'and', 'all']) {
    chain[method] = jest.fn(() => chain);
  }
  chain.exec = jest.fn().mockResolvedValue(rows);
  return chain;
};

describe('TimeslotsService - festivos oficiales', () => {
  const businessId = 'business-1';
  const timezoneOffset = -300;
  // Domingo 2026-11-01 00:00 hora local: lunes 2 de noviembre es festivo en Colombia.
  const startDate = '2026-11-01T05:00:00.000Z';

  let service: TimeslotsService;
  let holidays: { officialDates: jest.Mock };
  let activeTime: Record<string, unknown>;

  const horasPorDia = async () => {
    const response = await service.getAvailableTimeslots(businessId, {
      serviceId: 'service-1',
      startDate,
      days: 3,
      timezoneOffset,
    } as any);
    return Object.fromEntries(
      Object.entries(response.data).map(([date, slots]) => [
        date,
        slots.map((slot) => moment.utc(slot.startTime).add(timezoneOffset, 'minutes').format('HH:mm')),
      ]),
    );
  };

  beforeEach(async () => {
    holidays = { officialDates: jest.fn().mockResolvedValue(new Set(['2026-11-02'])) };
    activeTime = {
      monday: { startTime: '08:00', endTime: '10:00' },
      tuesday: { startTime: '08:00', endTime: '10:00' },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeslotsService,
        { provide: OfficialHolidaysService, useValue: holidays },
        {
          provide: UsersService,
          useValue: {
            findEmployees: jest.fn().mockResolvedValue({ success: true, data: [{ id: 'emp-1', status: true }] }),
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
          useValue: { query: jest.fn(() => chainableQuery([{ group: 'activeTime', value: JSON.stringify(activeTime) }])) },
        },
      ],
    }).compile();

    service = module.get(TimeslotsService);
  });

  it('con «no atiendo festivos» no ofrece ninguna hora el festivo y sí los demás días', async () => {
    activeTime.closedOnHolidays = true;

    const slots = await horasPorDia();

    expect(slots['2026-11-02']).toBeUndefined();
    expect(slots['2026-11-03']).toEqual(['08:00', '09:00']);
  });

  it('pide los festivos del rango consultado, en fechas locales', async () => {
    activeTime.closedOnHolidays = true;

    await horasPorDia();

    expect(holidays.officialDates).toHaveBeenCalledWith(businessId, '2026-11-01', '2026-11-03');
  });

  it('sin el interruptor ofrece horas el festivo y ni siquiera pregunta por festivos', async () => {
    const slots = await horasPorDia();

    expect(slots['2026-11-02']).toEqual(['08:00', '09:00']);
    expect(holidays.officialDates).not.toHaveBeenCalled();
  });

  it('con el interruptor apagado explícitamente tampoco cierra festivos', async () => {
    activeTime.closedOnHolidays = false;

    const slots = await horasPorDia();

    expect(slots['2026-11-02']).toEqual(['08:00', '09:00']);
  });

  it('si no se pudieron leer los festivos (conjunto vacío), la agenda sigue ofreciendo horas', async () => {
    activeTime.closedOnHolidays = true;
    holidays.officialDates.mockResolvedValue(new Set());

    const slots = await horasPorDia();

    expect(slots['2026-11-02']).toEqual(['08:00', '09:00']);
  });

  it('la clave del interruptor no se confunde con un día de la semana', async () => {
    activeTime.closedOnHolidays = true;
    holidays.officialDates.mockResolvedValue(new Set());

    const slots = await horasPorDia();

    expect(Object.keys(slots)).toEqual(['2026-11-02', '2026-11-03']);
  });
});
