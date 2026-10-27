import { Logger } from '@nestjs/common';

import {
  REALTIME_PUBLISH_SLOW_MS,
  REALTIME_PUBLISH_TIMEOUT_MS,
  RealtimeAppointmentPayload,
  RealtimePublisherService,
} from './realtime-publisher.service';

describe('RealtimePublisherService', () => {
  const SECRET = 'super-secret-value-123';
  const URL_ = 'https://realtime.example.test/publish';
  const payload: RealtimeAppointmentPayload = {
    idBusiness: 'biz-1',
    action: 'created',
    appointmentId: 'apt-1',
    startDate: '2026-10-26T10:00:00.000Z',
    endDate: '2026-10-26T11:00:00.000Z',
    originUserId: 'user-1',
  };

  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let service: RealtimePublisherService;
  let fetchMock: jest.Mock;
  let warn: jest.SpyInstance;

  const warnings = () => warn.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    process.env.REALTIME_PUBLISH_URL = URL_;
    process.env.REALTIME_PUBLISH_SECRET = SECRET;
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    service = new RealtimePublisherService();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
  });

  it('sin URL o sin secreto no hace nada (ni llama a fetch)', async () => {
    delete process.env.REALTIME_PUBLISH_URL;
    await service.publishAppointmentChange(payload);

    process.env.REALTIME_PUBLISH_URL = URL_;
    delete process.env.REALTIME_PUBLISH_SECRET;
    await service.publishAppointmentChange(payload);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('éxito: POST al canal del negocio con el secreto, el payload y un tope de 2 s', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    fetchMock.mockResolvedValue({ ok: true });

    await service.publishAppointmentChange(payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(URL_);
    expect(init.method).toBe('POST');
    expect(init.headers['x-internal-secret']).toBe(SECRET);
    expect(JSON.parse(init.body)).toEqual({
      channels: ['business:biz-1'],
      event: { type: 'appointment', data: payload },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(timeoutSpy).toHaveBeenCalledWith(REALTIME_PUBLISH_TIMEOUT_MS);
    expect(REALTIME_PUBLISH_TIMEOUT_MS).toBe(2000);
    expect(warn).not.toHaveBeenCalled();
  });

  it('respuesta no ok: avisa en el log y no lanza', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    });

    await expect(service.publishAppointmentChange(payload)).resolves.toBeUndefined();

    expect(warnings().join('\n')).toContain('503');
  });

  it('error de red: avisa en el log y no lanza', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));

    await expect(service.publishAppointmentChange(payload)).resolves.toBeUndefined();

    expect(warnings().join('\n')).toContain('ECONNRESET');
  });

  it('timeout (la señal aborta): avisa del tope y no lanza', async () => {
    fetchMock.mockImplementation(
      (_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          if (init.signal.aborted) return reject(init.signal.reason);
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        }),
    );
    // Tope real de la señal acortado para no esperar 2 s en la prueba.
    jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => AbortSignal.abort(new DOMException('t', 'TimeoutError')));

    await expect(service.publishAppointmentChange(payload)).resolves.toBeUndefined();

    expect(warnings().join('\n')).toContain('timeout after 2000 ms');
  });

  it('publicación lenta pero correcta: deja un aviso por pasar de 500 ms', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve({ ok: true }), REALTIME_PUBLISH_SLOW_MS + 300);
        }),
    );

    const pending = service.publishAppointmentChange(payload);
    await jest.advanceTimersByTimeAsync(REALTIME_PUBLISH_SLOW_MS + 300);
    await pending;

    expect(warnings().join('\n')).toMatch(/slow: 8\d\d ms/);
  });

  it('una publicación rápida no deja avisos', async () => {
    fetchMock.mockResolvedValue({ ok: true });
    await service.publishAppointmentChange(payload);
    expect(warn).not.toHaveBeenCalled();
  });

  it('nunca filtra el secreto en el log, falle como falle', async () => {
    fetchMock.mockRejectedValueOnce(new Error(`boom ${URL_}`));
    await service.publishAppointmentChange(payload);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'server error',
    });
    await service.publishAppointmentChange(payload);
    fetchMock.mockImplementationOnce(() => {
      throw new TypeError('fetch failed');
    });
    await service.publishAppointmentChange(payload);

    expect(warn).toHaveBeenCalledTimes(3);
    for (const line of warnings()) {
      expect(line).not.toContain(SECRET);
    }
  });
});
