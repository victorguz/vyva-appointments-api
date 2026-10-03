import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';

import { AppointmentChannel } from '../../core/constants/domain.constants';
import { AdConversionDispatchService } from '../shared/ad-conversion-dispatch.service';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { RealtimePublisherService } from '../shared/realtime-publisher.service';
import { WebhookDispatchService } from '../shared/webhook-dispatch.service';
import { AppointmentsService } from './appointments.service';

/**
 * El bot agenda con el usuario de un administrador para poder llamar a la API,
 * pero esa persona no creó la cita: quedaba mezclada con lo que agenda a mano.
 * El canal dice por dónde entró, igual que en las ventas, y el creador del bot
 * es «chatbot».
 */
describe('Canal y creador de una cita', () => {
  let service: AppointmentsService;
  const administrador = { id: 'admin-1', idBusiness: 'biz-1' } as any;

  const cuerpo = (extra: Record<string, unknown> = {}) => ({
    startDate: new Date(Date.now() + 86_400_000).toISOString(),
    endDate: new Date(Date.now() + 86_400_000 + 3_600_000).toISOString(),
    idService: 'servicio-1',
    ...extra,
  });

  const crear = (body: Record<string, unknown>) =>
    (service as any).createAppointmentObject(body, administrador);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: LambdaInvokeService, useValue: {} },
        { provide: RealtimePublisherService, useValue: {} },
        { provide: WebhookDispatchService, useValue: {} },
        { provide: AdConversionDispatchService, useValue: {} },
        { provide: getModelToken('Appointment'), useValue: {} },
        { provide: getModelToken('Customer'), useValue: {} },
        { provide: getModelToken('User'), useValue: {} },
        { provide: getModelToken('Product'), useValue: {} },
      ],
    }).compile();
    service = module.get(AppointmentsService);
    (service as any).resolveServiceNames = jest.fn(async (services: unknown[]) => services);
  });

  it('la que agenda el bot queda con el canal chatbot y creada por «chatbot»', async () => {
    const cita = await crear(cuerpo({ channel: AppointmentChannel.chatbot }));

    expect(cita.channel).toBe('chatbot');
    expect(cita.createdBy).toBe('chatbot');
  });

  it('la del equipo queda con el canal app y creada por quien la agenda', async () => {
    const cita = await crear(cuerpo());

    expect(cita.channel).toBe('app');
    expect(cita.createdBy).toBe('admin-1');
  });

  it('con confirmedBy deja escrito qué persona verificó el pago, sin cambiar al creador', async () => {
    const cita = await crear(cuerpo({ channel: AppointmentChannel.chatbot, confirmedBy: 'persona-7' }));

    expect(cita.createdBy).toBe('chatbot');
    expect(cita.modifiedBy).toBe('persona-7');
  });

  it('sin confirmedBy no inventa quién la modificó', async () => {
    const cita = await crear(cuerpo({ channel: AppointmentChannel.chatbot }));

    expect(cita.modifiedBy).toBeUndefined();
  });

  it('un canal explícito de la app tampoco cambia al creador', async () => {
    const cita = await crear(cuerpo({ channel: AppointmentChannel.app }));

    expect(cita.createdBy).toBe('admin-1');
  });
});
