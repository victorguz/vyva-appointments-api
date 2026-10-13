import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';

import { AppointmentsService } from './appointments.service';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { RealtimePublisherService } from '../shared/realtime-publisher.service';
import { WebhookDispatchService } from '../shared/webhook-dispatch.service';
import { AdConversionDispatchService } from '../shared/ad-conversion-dispatch.service';

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: LambdaInvokeService, useValue: {} },
        { provide: RealtimePublisherService, useValue: {} },
        { provide: WebhookDispatchService, useValue: {} },
        { provide: AdConversionDispatchService, useValue: {} },
        {
          provide: getModelToken('Appointment'),
          useValue: {},
        },
        {
          provide: getModelToken('Customer'),
          useValue: {},
        },
        {
          provide: getModelToken('User'),
          useValue: {},
        },
        {
          provide: getModelToken('Product'),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('series de sesiones', () => {
    /** Deja pasar solo lo que importa: cómo se arma cada cita de la serie. */
    const preparar = () => {
      const built: any[] = [];
      const internals = service as any;
      internals.createAppointmentObject = jest.fn(async (body: any) => {
        built.push(body);
        return { id: `cita-${built.length}`, services: body.services, idBusiness: 'b1' };
      });
      internals.transaction = jest.fn().mockResolvedValue(undefined);
      internals.model = {
        transaction: { create: jest.fn() },
        get: jest.fn(async ({ id }: any) => ({ toJSON: () => ({ id, idBusiness: 'b1' }) })),
        delete: jest.fn(),
      };
      internals.certifyAppointmentsCreated = jest.fn(async (payloads: any[]) => payloads);
      internals.syncAllToGoogleCalendar = jest.fn().mockResolvedValue({ synced: true });
      internals.notifyAppointmentChange = jest.fn();
      internals.webhookDispatch = { dispatch: jest.fn().mockResolvedValue(undefined) };
      internals.adConversionDispatch = { appointmentBooked: jest.fn().mockResolvedValue(undefined) };
      return built;
    };
    const servicio = (price: number) => [{ id: 's1', name: 'Microneedling x4', price, offerPrice: price, measure: 60 }];

    it('cada sesión de un paquete nace con el valor que le toca', async () => {
      const built = preparar();

      await service.create(
        {
          startDate: '2026-10-19T20:00:00.000Z',
          endDate: '2026-10-19T21:00:00.000Z',
          services: servicio(200000),
          additionalSessions: [
            { startDate: '2026-10-26T20:00:00.000Z', endDate: '2026-10-26T21:00:00.000Z', services: servicio(200000) },
            { startDate: '2026-11-02T20:00:00.000Z', endDate: '2026-11-02T21:00:00.000Z', services: servicio(200000) },
          ],
        } as any,
        { id: 'u1', idBusiness: 'b1' } as any,
      );

      expect(built.map((b) => b.services[0].price)).toEqual([200000, 200000, 200000]);
      expect(built.map((b) => b.startDate)).toEqual([
        '2026-10-19T20:00:00.000Z',
        '2026-10-26T20:00:00.000Z',
        '2026-11-02T20:00:00.000Z',
      ]);
    });

    it('una serie sin servicios propios sigue heredando los de la cita principal', async () => {
      const built = preparar();

      await service.create(
        {
          startDate: '2026-10-19T20:00:00.000Z',
          endDate: '2026-10-19T21:00:00.000Z',
          services: servicio(250000),
          additionalSessions: [
            { startDate: '2026-10-26T20:00:00.000Z', endDate: '2026-10-26T21:00:00.000Z' },
          ],
        } as any,
        { id: 'u1', idBusiness: 'b1' } as any,
      );

      expect(built[1].services).toEqual(servicio(250000));
    });
  });
});
