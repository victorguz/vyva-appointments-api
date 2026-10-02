import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';

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
 * «Lista» es una lista de espera, no una persona: si las horas libres la
 * contaran, el asistente y la agenda pública agendarían ahí.
 */
describe('TimeslotsService - agenda pública', () => {
  const businessId = 'business-1';
  const startDate = '2026-09-14T05:00:00.000Z';

  const montar = async (employees: Array<Record<string, unknown>>) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeslotsService,
        {
          provide: UsersService,
          useValue: { findEmployees: jest.fn().mockResolvedValue({ success: true, data: employees }) },
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
    return module.get<TimeslotsService>(TimeslotsService);
  };

  const empleadosConHoras = async (
    employees: Array<Record<string, unknown>>,
    extra: Record<string, unknown> = {},
  ) => {
    const service = await montar(employees);
    const response = await service.getAvailableTimeslots(businessId, {
      serviceId: 'service-1',
      startDate,
      days: 1,
      timezoneOffset: -300,
      ...extra,
    } as any);
    const ids = new Set<string>();
    for (const slots of Object.values(response.data)) {
      for (const slot of slots) ids.add(slot.idEmployee);
    }
    return ids;
  };

  it('no ofrece horas de quien tiene showInPublicAgenda en false', async () => {
    const ids = await empleadosConHoras([
      { id: 'lista', status: true, showInPublicAgenda: false },
      { id: 'daniela', status: true, showInPublicAgenda: true },
    ]);

    expect(ids).toEqual(new Set(['daniela']));
  });

  it('un empleado anterior al campo (sin valor) sigue ofreciendo horas', async () => {
    const ids = await empleadosConHoras([{ id: 'leivis', status: true }]);

    expect(ids).toEqual(new Set(['leivis']));
  });

  it('si solo queda la lista de espera no hay horas', async () => {
    const ids = await empleadosConHoras([{ id: 'lista', status: true, showInPublicAgenda: false }]);

    expect(ids.size).toBe(0);
  });

  it('pedir a la lista de espera por su id tampoco da horas', async () => {
    const ids = await empleadosConHoras(
      [
        { id: 'lista', status: true, showInPublicAgenda: false },
        { id: 'daniela', status: true },
      ],
      { employeeId: 'lista' },
    );

    expect(ids.size).toBe(0);
  });

  it('un empleado inactivo sigue sin ofrecer horas', async () => {
    const ids = await empleadosConHoras([
      { id: 'sofia', status: false },
      { id: 'daniela', status: true },
    ]);

    expect(ids).toEqual(new Set(['daniela']));
  });
});
