import { AppointmentStatus } from '../../core/constants/domain.constants';
import { Appointment } from '../../schemas/appointment.schema';
import { AdConversionDispatchService } from './ad-conversion-dispatch.service';

describe('Aviso de cita a conversiones de anuncios', () => {
  let send: jest.Mock;
  let servicio: AdConversionDispatchService;

  const cita = (extra: Partial<Appointment> = {}) =>
    ({
      id: 'cita-1',
      idBusiness: 'biz-1',
      idCustomer: 'cliente-1',
      status: AppointmentStatus.pending,
      ...extra,
    }) as Appointment;

  const enviado = () => JSON.parse(Buffer.from(send.mock.calls[0][0].input.Payload).toString());

  beforeEach(() => {
    const config = { get: (key: string) => (key === 'NODE_ENV' ? 'prd' : undefined) };
    servicio = new AdConversionDispatchService(config as any);
    send = jest.fn().mockResolvedValue({ StatusCode: 202 });
    (servicio as any).lambdaClient = { send };
  });

  it('avisa a WhatsApp sin esperar, con quién agendó y cuándo', async () => {
    await servicio.appointmentBooked(cita());

    const input = send.mock.calls[0][0].input;
    expect(input.FunctionName).toBe('vyva-whatsapp-prd-adConversion');
    expect(input.InvocationType).toBe('Event');
    expect(enviado()).toMatchObject({
      kind: 'appointment',
      idBusiness: 'biz-1',
      idCustomer: 'cliente-1',
      sourceId: 'cita-1',
    });
  });

  it.each([
    AppointmentStatus.timeOut,
    AppointmentStatus.canceled,
    AppointmentStatus.canceledByCustomer,
  ])('no avisa de una cita que nace %s', async (status) => {
    await servicio.appointmentBooked(cita({ status }));

    expect(send).not.toHaveBeenCalled();
  });

  it('no avisa de una cita sin cliente', async () => {
    await servicio.appointmentBooked(cita({ idCustomer: undefined }));

    expect(send).not.toHaveBeenCalled();
  });

  // La cita ya está guardada: que falle el aviso no puede tumbarla.
  it('si no puede avisar, no revienta', async () => {
    send.mockRejectedValue(new Error('sin permiso'));

    await expect(servicio.appointmentBooked(cita())).resolves.toBeUndefined();
  });
});
