import { Test } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';

import { AppointmentsService } from './appointments.service';
import { AppointmentsCustomerService } from './appointments-customer.service';
import { TimeOutAppointmentsService } from './timeout-appointments.service';
import { ExternalImportService } from './external-import.service';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { WebhookDispatchService } from '../shared/webhook-dispatch.service';
import { AdConversionDispatchService } from '../shared/ad-conversion-dispatch.service';
import {
  REALTIME_PUBLISH_TIMEOUT_MS,
  RealtimePublisherService,
} from '../shared/realtime-publisher.service';

/**
 * Tiempo real de citas: cada operación publica UNA vez, nunca falla por culpa
 * del publicador y no suma más de ~2 s aunque el realtime esté caído/lento.
 */
describe('Tiempo real de citas', () => {
  const START = new Date('2026-10-26T15:00:00.000Z');
  const END = new Date('2026-10-26T16:00:00.000Z');
  const user = { id: 'user-1', idBusiness: 'b1' } as any;

  const record = (extra: Record<string, any> = {}) => ({
    id: 'apt-1',
    idBusiness: 'b1',
    startDate: START,
    endDate: END,
    status: 'scheduled',
    ...extra,
  });
  const asDoc = (rec: any) => ({ ...rec, toJSON: () => rec });

  /** Espera de reloj falso: `ms` de tiempo simulado. */
  const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** Marca cuándo termina una promesa, sin esperarla. */
  const track = <T>(promise: Promise<T>) => {
    const state = { done: false, error: undefined as unknown };
    promise.then(
      () => (state.done = true),
      (e) => {
        state.done = true;
        state.error = e;
      },
    );
    return state;
  };

  describe('AppointmentsService', () => {
    let service: AppointmentsService;
    let publisher: { publishAppointmentChange: jest.Mock };
    let webhook: { dispatch: jest.Mock };
    let model: any;
    let stored: any;

    beforeEach(async () => {
      stored = record();
      publisher = { publishAppointmentChange: jest.fn().mockResolvedValue(undefined) };
      webhook = { dispatch: jest.fn().mockResolvedValue(undefined) };
      model = {
        get: jest.fn(async () => asDoc(stored)),
        update: jest.fn(async (): Promise<void> => undefined),
        delete: jest.fn(async (): Promise<void> => undefined),
        transaction: { create: jest.fn(), update: jest.fn() },
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          AppointmentsService,
          { provide: LambdaInvokeService, useValue: {} },
          { provide: RealtimePublisherService, useValue: publisher },
          { provide: WebhookDispatchService, useValue: webhook },
          {
            provide: AdConversionDispatchService,
            useValue: { appointmentBooked: jest.fn().mockResolvedValue(undefined) },
          },
          { provide: getModelToken('Appointment'), useValue: model },
          { provide: getModelToken('Customer'), useValue: {} },
          { provide: getModelToken('User'), useValue: {} },
          { provide: getModelToken('Product'), useValue: {} },
        ],
      }).compile();
      service = moduleRef.get(AppointmentsService);
      const internals = service as any;
      internals.transaction = jest.fn().mockResolvedValue(undefined);
      internals.syncAppointmentToGoogleCalendar = jest
        .fn()
        .mockResolvedValue({ synced: true });
      internals.syncAllToGoogleCalendar = jest
        .fn()
        .mockResolvedValue({ synced: true });
      internals.createAppointmentObject = jest.fn(async () => record());
      internals.certifyAppointmentsCreated = jest.fn(async (p: any[]) => p);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const createBody = {
      startDate: START.toISOString(),
      endDate: END.toISOString(),
    } as any;

    it('crear: publica una sola vez, con el id de quien lo hizo y sin datos de la clienta', async () => {
      stored = record({ customerName: 'Clienta Secreta', idCustomer: 'c1' });
      await service.create(createBody, user);

      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(1);
      const payload = publisher.publishAppointmentChange.mock.calls[0][0];
      expect(payload).toEqual({
        idBusiness: 'b1',
        action: 'created',
        appointmentId: 'apt-1',
        startDate: START.toISOString(),
        endDate: END.toISOString(),
        originUserId: 'user-1',
      });
      expect(JSON.stringify(payload)).not.toContain('Clienta Secreta');
    });

    it('crear: el evento sale antes de la sincronización con Google Calendar', async () => {
      const order: string[] = [];
      publisher.publishAppointmentChange.mockImplementation(async () => {
        order.push('realtime');
      });
      (service as any).syncAllToGoogleCalendar = jest.fn(async () => {
        order.push('google');
        return { synced: true };
      });

      await service.create(createBody, user);

      expect(order).toEqual(['realtime', 'google']);
    });

    it('crear: aunque el publicador falle (rechace o lance), la cita se crea', async () => {
      publisher.publishAppointmentChange.mockRejectedValue(new Error('realtime caído'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await service.create(createBody, user);

      expect(res.data?.id).toBe('apt-1');
      expect(webhook.dispatch).toHaveBeenCalledTimes(1);
    });

    it('crear: sin idBusiness no publica', async () => {
      stored = record({ idBusiness: undefined });
      (service as any).certifyAppointmentsCreated = jest.fn(async () => [stored]);

      await service.create(createBody, user);

      expect(publisher.publishAppointmentChange).not.toHaveBeenCalled();
    });

    it('actualizar: publica una sola vez, antes del sync de Google', async () => {
      const order: string[] = [];
      publisher.publishAppointmentChange.mockImplementation(async () => {
        order.push('realtime');
      });
      (service as any).syncAppointmentToGoogleCalendar = jest.fn(async () => {
        order.push('google');
        return { synced: true };
      });

      await service.update('apt-1', { notes: 'hola' } as any, user);

      expect(order).toEqual(['realtime', 'google']);
      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(1);
      expect(publisher.publishAppointmentChange.mock.calls[0][0]).toMatchObject({
        action: 'updated',
        appointmentId: 'apt-1',
        originUserId: 'user-1',
      });
      expect(webhook.dispatch).toHaveBeenCalledTimes(1);
    });

    it('actualizar solo para enlazar un pago: publica una vez y no sincroniza Google ni webhooks', async () => {
      await service.update('apt-1', { idOrder: 'order-1' } as any, user);

      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(1);
      expect(publisher.publishAppointmentChange.mock.calls[0][0]).toMatchObject({
        action: 'updated',
        appointmentId: 'apt-1',
      });
      expect((service as any).syncAppointmentToGoogleCalendar).not.toHaveBeenCalled();
      expect(webhook.dispatch).not.toHaveBeenCalled();
    });

    it('cambio de estado: publica una sola vez, antes del sync de Google', async () => {
      const order: string[] = [];
      publisher.publishAppointmentChange.mockImplementation(async () => {
        order.push('realtime');
      });
      (service as any).syncAppointmentToGoogleCalendar = jest.fn(async () => {
        order.push('google');
        return { synced: true };
      });

      await service.updateStatus('apt-1', { status: 'confirmed' } as any, user);

      expect(order).toEqual(['realtime', 'google']);
      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(1);
      expect(publisher.publishAppointmentChange.mock.calls[0][0]).toMatchObject({
        action: 'updated',
        originUserId: 'user-1',
      });
    });

    it('cambio de estado sin usuario: usa modifiedBy como origen, o lo omite', async () => {
      await service.updateStatus(
        'apt-1',
        { status: 'confirmed', modifiedBy: 'bot-9' } as any,
        undefined,
      );
      expect(publisher.publishAppointmentChange.mock.calls[0][0].originUserId).toBe('bot-9');

      publisher.publishAppointmentChange.mockClear();
      await service.updateStatus('apt-1', { status: 'confirmed' } as any, undefined);
      expect(publisher.publishAppointmentChange.mock.calls[0][0]).not.toHaveProperty(
        'originUserId',
      );
    });

    it('borrar: publica "deleted" una sola vez, después de borrar', async () => {
      const order: string[] = [];
      model.delete.mockImplementation(async () => {
        order.push('delete');
      });
      publisher.publishAppointmentChange.mockImplementation(async () => {
        order.push('realtime');
      });

      await service.remove('apt-1', user);

      expect(order).toEqual(['delete', 'realtime']);
      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(1);
      expect(publisher.publishAppointmentChange.mock.calls[0][0]).toMatchObject({
        action: 'deleted',
        appointmentId: 'apt-1',
      });
    });

    it('ninguna operación falla si el publicador falla', async () => {
      publisher.publishAppointmentChange.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.update('apt-1', { notes: 'x' } as any, user)).resolves.toBeDefined();
      await expect(
        service.update('apt-1', { idOrder: 'o1' } as any, user),
      ).resolves.toBeDefined();
      await expect(
        service.updateStatus('apt-1', { status: 'confirmed' } as any, user),
      ).resolves.toBeDefined();
      await expect(service.remove('apt-1')).resolves.toBeDefined();
    });

    describe('con un publicador lento (realtime real, red de 5 s, tope de 2 s)', () => {
      let slowFetch: jest.Mock;
      const originalFetch = global.fetch;
      const originalEnv = { ...process.env };

      beforeEach(() => {
        jest.useFakeTimers();
        process.env.REALTIME_PUBLISH_URL = 'https://rt.example.test/publish';
        process.env.REALTIME_PUBLISH_SECRET = 'secret';
        // AbortSignal.timeout usa el reloj real: lo atamos al reloj falso.
        jest.spyOn(AbortSignal, 'timeout').mockImplementation((ms: number) => {
          const controller = new AbortController();
          setTimeout(
            () => controller.abort(new DOMException('timeout', 'TimeoutError')),
            ms,
          );
          return controller.signal;
        });
        // El servidor tarda 5 s en responder; fetch respeta el abort.
        slowFetch = jest.fn(
          (_url: string, init: { signal: AbortSignal }) =>
            new Promise((resolve, reject) => {
              const timer = setTimeout(() => resolve({ ok: true }), 5000);
              init.signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(init.signal.reason);
              });
            }),
        );
        global.fetch = slowFetch as unknown as typeof fetch;
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const real = new RealtimePublisherService();
        publisher.publishAppointmentChange.mockImplementation((p: any) =>
          real.publishAppointmentChange(p),
        );
      });

      afterEach(() => {
        global.fetch = originalFetch;
        process.env = { ...originalEnv };
      });

      it('borrar (nada más que esperar): suma como mucho el tope de 2 s', async () => {
        const state = track(service.remove('apt-1', user));

        await jest.advanceTimersByTimeAsync(REALTIME_PUBLISH_TIMEOUT_MS - 1);
        expect(state.done).toBe(false);
        await jest.advanceTimersByTimeAsync(100);

        expect(state.done).toBe(true);
        expect(state.error).toBeUndefined();
        expect(slowFetch).toHaveBeenCalledTimes(1);
      });

      it('crear: el realtime corre en paralelo con Google (3 s) y no suma tiempo', async () => {
        (service as any).syncAllToGoogleCalendar = jest.fn(async () => {
          await wait(3000);
          return { synced: true };
        });

        const state = track(service.create(createBody, user));

        await jest.advanceTimersByTimeAsync(2999);
        expect(state.done).toBe(false);
        await jest.advanceTimersByTimeAsync(1);

        // Terminó a los 3,0 s: lo que tarda Google; el realtime (2 s) no sumó.
        expect(state.done).toBe(true);
        expect(state.error).toBeUndefined();
      });

      it('actualizar: el realtime corre en paralelo con Google (3 s) y no suma tiempo', async () => {
        (service as any).syncAppointmentToGoogleCalendar = jest.fn(async () => {
          await wait(3000);
          return { synced: true };
        });

        const state = track(service.update('apt-1', { notes: 'x' } as any, user));

        await jest.advanceTimersByTimeAsync(2999);
        expect(state.done).toBe(false);
        await jest.advanceTimersByTimeAsync(1);

        expect(state.done).toBe(true);
        expect(state.error).toBeUndefined();
      });

      it('actualizar solo un pago: suma como mucho 2 s y no falla', async () => {
        const state = track(service.update('apt-1', { idOrder: 'o1' } as any, user));

        await jest.advanceTimersByTimeAsync(REALTIME_PUBLISH_TIMEOUT_MS + 100);

        expect(state.done).toBe(true);
        expect(state.error).toBeUndefined();
      });

      it('cambio de estado sin Google: suma como mucho 2,1 s y no falla', async () => {
        const state = track(
          service.updateStatus('apt-1', { status: 'confirmed' } as any, user),
        );

        await jest.advanceTimersByTimeAsync(REALTIME_PUBLISH_TIMEOUT_MS + 100);

        expect(state.done).toBe(true);
        expect(state.error).toBeUndefined();
      });
    });
  });

  describe('AppointmentsCustomerService.cancelCustomerAppointment', () => {
    let service: AppointmentsCustomerService;
    let publisher: { publishAppointmentChange: jest.Mock };
    let webhook: { dispatch: jest.Mock };
    let lambda: { invokeFunction: jest.Mock };
    let stored: any;

    beforeEach(async () => {
      stored = record({ idCustomer: 'cust-1', customerName: 'Clienta Secreta' });
      publisher = { publishAppointmentChange: jest.fn().mockResolvedValue(undefined) };
      webhook = { dispatch: jest.fn().mockResolvedValue(undefined) };
      lambda = { invokeFunction: jest.fn().mockResolvedValue({}) };
      const moduleRef = await Test.createTestingModule({
        providers: [
          AppointmentsCustomerService,
          { provide: LambdaInvokeService, useValue: lambda },
          { provide: WebhookDispatchService, useValue: webhook },
          { provide: RealtimePublisherService, useValue: publisher },
          {
            provide: getModelToken('Appointment'),
            useValue: {
              get: jest.fn(async () => asDoc(stored)),
              update: jest.fn(async (_k: any, changes: any) => {
                stored = { ...stored, ...changes };
              }),
            },
          },
          { provide: getModelToken('Product'), useValue: {} },
          { provide: getModelToken('Business'), useValue: {} },
          {
            provide: getModelToken('Customer'),
            useValue: { get: jest.fn(async () => ({ id: 'cust-1', idUser: 'user-1' })) },
          },
        ],
      }).compile();
      service = moduleRef.get(AppointmentsCustomerService);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('la cancelación de la clienta publica "updated" una sola vez, con ids y fechas', async () => {
      const res = await service.cancelCustomerAppointment('apt-1', { id: 'user-1' } as any);

      expect(res.data?.status).toBe('canceledByCustomer');
      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(1);
      const payload = publisher.publishAppointmentChange.mock.calls[0][0];
      expect(payload).toEqual({
        idBusiness: 'b1',
        action: 'updated',
        appointmentId: 'apt-1',
        startDate: START.toISOString(),
        endDate: END.toISOString(),
        originUserId: 'user-1',
      });
      expect(JSON.stringify(payload)).not.toContain('Clienta Secreta');
    });

    it('si el publicador falla, la cancelación igual se completa', async () => {
      publisher.publishAppointmentChange.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await service.cancelCustomerAppointment('apt-1', { id: 'user-1' } as any);

      expect(res.data?.status).toBe('canceledByCustomer');
      expect(webhook.dispatch).toHaveBeenCalledTimes(1);
    });

    it('con un publicador de 5 s y Google de 3 s no suma tiempo (en paralelo)', async () => {
      jest.useFakeTimers();
      // Publicador "real" con tope de 2 s sobre un servidor de 5 s.
      publisher.publishAppointmentChange.mockImplementation(() =>
        Promise.race([wait(5000), wait(REALTIME_PUBLISH_TIMEOUT_MS)]),
      );
      lambda.invokeFunction.mockImplementation(async () => {
        await wait(3000);
        return {};
      });

      const state = track(
        service.cancelCustomerAppointment('apt-1', { id: 'user-1' } as any),
      );

      await jest.advanceTimersByTimeAsync(2999);
      expect(state.done).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      expect(state.done).toBe(true);
      expect(state.error).toBeUndefined();
    });
  });

  describe('TimeOutAppointmentsService.createBatch', () => {
    let service: TimeOutAppointmentsService;
    let publisher: { publishAppointmentChange: jest.Mock };
    let lambda: { invokeFunction: jest.Mock };

    beforeEach(async () => {
      const rows = new Map<string, any>();
      publisher = { publishAppointmentChange: jest.fn().mockResolvedValue(undefined) };
      lambda = { invokeFunction: jest.fn().mockResolvedValue({ data: {} }) };
      const moduleRef = await Test.createTestingModule({
        providers: [
          TimeOutAppointmentsService,
          { provide: LambdaInvokeService, useValue: lambda },
          { provide: RealtimePublisherService, useValue: publisher },
          {
            provide: getModelToken('Appointment'),
            useValue: {
              create: jest.fn(async (p: any) => rows.set(p.id, { ...p })),
              get: jest.fn(async ({ id }: any) =>
                rows.has(id) ? asDoc(rows.get(id)) : undefined,
              ),
              update: jest.fn(),
              delete: jest.fn(),
            },
          },
        ],
      }).compile();
      service = moduleRef.get(TimeOutAppointmentsService);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const dto = {
      startDate: START.toISOString(),
      endDate: END.toISOString(),
      employeeIds: ['e1', 'e2', 'e3'],
      customerName: 'Cierre',
    } as any;

    it('publica una vez por bloque creado, con el usuario de origen', async () => {
      await service.createBatch(dto, user);

      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(3);
      const ids = publisher.publishAppointmentChange.mock.calls.map(
        (c) => c[0].appointmentId,
      );
      expect(new Set(ids).size).toBe(3);
      for (const [payload] of publisher.publishAppointmentChange.mock.calls) {
        expect(payload).toMatchObject({
          idBusiness: 'b1',
          action: 'created',
          originUserId: 'user-1',
        });
      }
    });

    it('si el publicador falla, el lote igual se crea completo', async () => {
      publisher.publishAppointmentChange.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await service.createBatch(dto, user);

      expect(res.data).toHaveLength(3);
    });

    it('con 3 bloques y un publicador de 5 s (tope 2 s) el lote suma como mucho 2 s, no 6', async () => {
      jest.useFakeTimers();
      // Cada publicación tarda lo mismo (2 s tras el tope); corren en paralelo.
      publisher.publishAppointmentChange.mockImplementation(() =>
        wait(REALTIME_PUBLISH_TIMEOUT_MS),
      );

      const state = track(service.createBatch(dto, user));

      await jest.advanceTimersByTimeAsync(REALTIME_PUBLISH_TIMEOUT_MS - 1);
      expect(state.done).toBe(false);
      await jest.advanceTimersByTimeAsync(100);
      expect(state.done).toBe(true);
      expect(state.error).toBeUndefined();
    });
  });

  describe('ExternalImportService.importBatch', () => {
    let service: ExternalImportService;
    let publisher: { publishAppointmentChange: jest.Mock };

    beforeEach(async () => {
      publisher = { publishAppointmentChange: jest.fn().mockResolvedValue(undefined) };
      const query: any = {
        eq: () => query,
        filter: () => query,
        all: () => query,
        exec: async (): Promise<any[]> => [],
      };
      const moduleRef = await Test.createTestingModule({
        providers: [
          ExternalImportService,
          { provide: RealtimePublisherService, useValue: publisher },
          {
            provide: getModelToken('Appointment'),
            useValue: { query: () => query, create: jest.fn() },
          },
          {
            provide: getModelToken('User'),
            useValue: {
              get: async ({ id }: any) => ({
                toJSON: () => ({ id, name: 'María', idBusiness: 'b1' }),
              }),
            },
          },
        ],
      }).compile();
      service = moduleRef.get(ExternalImportService);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    const day = 86400000;
    const items = (n: number) => ({
      items: Array.from({ length: n }, (_, i) => ({
        idEmployee: 'e1',
        sourceCalendarId: 'cal',
        sourceEventId: `ev-${i}`,
        title: `Evento ${i}`,
        startDate: new Date(Date.now() + (2 + i) * day).toISOString(),
        endDate: new Date(Date.now() + (2 + i) * day + 3600000).toISOString(),
      })),
    }) as any;

    it('publica una vez por evento importado, con el usuario de origen', async () => {
      await service.importBatch(items(4), user);

      expect(publisher.publishAppointmentChange).toHaveBeenCalledTimes(4);
      expect(publisher.publishAppointmentChange.mock.calls[0][0]).toMatchObject({
        idBusiness: 'b1',
        action: 'created',
        originUserId: 'user-1',
      });
    });

    it('si el publicador falla, la importación igual termina', async () => {
      publisher.publishAppointmentChange.mockRejectedValue(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementation(() => {});

      const res = await service.importBatch(items(2), user);

      expect(res.data.created).toBe(2);
    });

    it('con 20 eventos y un publicador lento: UNA espera paralela, no 20', async () => {
      jest.useFakeTimers();
      publisher.publishAppointmentChange.mockImplementation(() =>
        wait(REALTIME_PUBLISH_TIMEOUT_MS),
      );

      const state = track(service.importBatch(items(20), user));

      await jest.advanceTimersByTimeAsync(REALTIME_PUBLISH_TIMEOUT_MS - 1);
      expect(state.done).toBe(false);
      await jest.advanceTimersByTimeAsync(100);
      expect(state.done).toBe(true);
      expect(state.error).toBeUndefined();
    });
  });
});
