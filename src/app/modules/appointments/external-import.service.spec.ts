import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';

import { ExternalImportService } from './external-import.service';
import { RealtimePublisherService } from '../shared/realtime-publisher.service';
import { ImportExternalAppointmentsDto } from './dto/appointments.dto';

describe('ExternalImportService', () => {
  let service: ExternalImportService;
  let created: any[];
  let existingRows: any[];
  let realtime: { publishAppointmentChange: jest.Mock };

  const user = { id: 'admin-1', idBusiness: 'biz-1' } as any;
  const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString();
  const item = (eventId: string, extra: Record<string, any> = {}) => ({
    idEmployee: 'emp-1',
    sourceCalendarId: 'cal-1',
    sourceEventId: eventId,
    title: `Evento ${eventId}`,
    startDate: future(2),
    endDate: future(2.05),
    ...extra,
  });
  const dto = (...items: any[]): ImportExternalAppointmentsDto => ({ items });

  beforeEach(async () => {
    created = [];
    existingRows = [];
    realtime = { publishAppointmentChange: jest.fn() };
    const employees: Record<string, any> = {
      'emp-1': { id: 'emp-1', name: 'María', idBusiness: 'biz-1' },
      'emp-2': { id: 'emp-2', name: 'Daniela', idBusiness: 'biz-1' },
      'otro': { id: 'otro', name: 'De otro negocio', idBusiness: 'biz-2' },
    };
    const query = {
      eq: () => query,
      filter: () => query,
      all: () => query,
      exec: async () => existingRows.map((r) => ({ toJSON: () => r })),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExternalImportService,
        { provide: RealtimePublisherService, useValue: realtime },
        {
          provide: getModelToken('Appointment'),
          useValue: {
            query: () => query,
            create: jest.fn(async (row: any) => {
              created.push(row);
              existingRows.push(row);
            }),
          },
        },
        {
          provide: getModelToken('User'),
          useValue: {
            get: async ({ id }: { id: string }) =>
              employees[id] ? { toJSON: () => employees[id] } : undefined,
          },
        },
      ],
    }).compile();
    service = module.get(ExternalImportService);
  });

  it('crea cada evento futuro como un bloqueo del empleado, que no es una cita', async () => {
    const res = await service.importBatch(dto(item('a', { description: 'Nota' })), user);

    expect(res.data).toEqual({ created: 1, duplicates: 0, past: 0, invalidEmployee: 0 });
    expect(created[0]).toMatchObject({
      status: 'timeOut',
      idBusiness: 'biz-1',
      idEmployee: 'emp-1',
      employeeName: 'María',
      customerName: 'Evento a',
      notes: 'Nota',
      channel: 'google-import',
      externalSource: 'google',
      externalId: 'google:cal-1:a:emp-1',
    });
    expect(created[0].googleCalendarEventId).toBeUndefined();
    expect(realtime.publishAppointmentChange).toHaveBeenCalledTimes(1);
  });

  it('repetir la importación no duplica nada', async () => {
    await service.importBatch(dto(item('a'), item('b')), user);
    const again = await service.importBatch(dto(item('a'), item('b'), item('c')), user);

    expect(again.data).toMatchObject({ created: 1, duplicates: 2 });
    expect(created).toHaveLength(3);
  });

  it('el mismo evento puede ir a otro empleado sin chocar con el primero', async () => {
    await service.importBatch(dto(item('a')), user);
    const res = await service.importBatch(dto(item('a', { idEmployee: 'emp-2' })), user);

    expect(res.data).toMatchObject({ created: 1, duplicates: 0 });
    expect(created.map((c) => c.idEmployee)).toEqual(['emp-1', 'emp-2']);
  });

  it('lo pasado o con horario inválido no se importa', async () => {
    const res = await service.importBatch(
      dto(
        item('ayer', { startDate: future(-1), endDate: future(-0.9) }),
        item('al-reves', { startDate: future(3), endDate: future(2) }),
        item('ok'),
      ),
      user,
    );

    expect(res.data).toMatchObject({ created: 1, past: 2 });
  });

  it('un empleado de otro negocio, o que no existe, se rechaza', async () => {
    const res = await service.importBatch(
      dto(item('a', { idEmployee: 'otro' }), item('b', { idEmployee: 'no-existe' }), item('c')),
      user,
    );

    expect(res.data).toMatchObject({ created: 1, invalidEmployee: 2 });
    expect(created.map((c) => c.idEmployee)).toEqual(['emp-1']);
  });

  it('acepta varios empleados en una sola importación', async () => {
    const res = await service.importBatch(
      dto(item('a'), item('a', { idEmployee: 'emp-2', sourceCalendarId: 'cal-2' })),
      user,
    );

    expect(res.data.created).toBe(2);
  });
});
