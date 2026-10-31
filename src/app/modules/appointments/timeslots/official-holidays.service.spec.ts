import { OfficialHolidaysService } from './official-holidays.service';

const holiday = (date: string, kind: string) => ({ date, name: 'x', kind });

describe('Festivos oficiales para la agenda', () => {
  const build = (response: unknown, fail = false) => {
    const lambdaInvoke = {
      invokeFunction: jest.fn(async () => {
        if (fail) throw new Error('integraciones caído');
        return response;
      }),
    };
    return { service: new OfficialHolidaysService(lambdaInvoke as any), lambdaInvoke };
  };

  it('solo cuentan los festivos oficiales: ni celebraciones ni festivos de una región', async () => {
    const { service } = build({
      data: { holidays: [holiday('2026-11-02', 'holiday'), holiday('2026-10-31', 'observance'), holiday('2026-11-11', 'regional')] },
    });

    const dates = await service.officialDates('b1', '2026-10-30', '2026-11-30');

    expect([...dates]).toEqual(['2026-11-02']);
  });

  it('le pide el rango a integraciones, en nombre del negocio', async () => {
    const { service, lambdaInvoke } = build({ data: { holidays: [] } });

    await service.officialDates('b1', '2026-11-01', '2026-11-03');

    expect(lambdaInvoke.invokeFunction).toHaveBeenCalledWith(
      'vyva-integrations',
      'GET',
      '/api/integrations/google-calendar/holidays',
      undefined,
      expect.objectContaining({ idBusiness: 'b1' }),
      { from: '2026-11-01', to: '2026-11-03' },
    );
  });

  it('reutiliza la respuesta del mismo rango', async () => {
    const { service, lambdaInvoke } = build({ data: { holidays: [holiday('2026-11-02', 'holiday')] } });

    await service.officialDates('b1', '2026-11-01', '2026-11-03');
    await service.officialDates('b1', '2026-11-01', '2026-11-03');

    expect(lambdaInvoke.invokeFunction).toHaveBeenCalledTimes(1);
  });

  it('si integraciones falla devuelve vacío en vez de lanzar, para no quedarse sin horas', async () => {
    const { service } = build(undefined, true);

    await expect(service.officialDates('b1', '2026-11-01', '2026-11-03')).resolves.toEqual(new Set());
  });
});
