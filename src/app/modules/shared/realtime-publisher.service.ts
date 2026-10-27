import { Injectable, Logger } from '@nestjs/common';

export type RealtimeAppointmentAction = 'created' | 'updated' | 'deleted';

export interface RealtimeAppointmentPayload {
  idBusiness: string;
  action: RealtimeAppointmentAction;
  appointmentId: string;
  startDate?: string;
  endDate?: string;
  /**
   * Id del usuario que hizo el cambio (si el servicio lo conoce). Sirve al
   * frontal para no repetir el refresco de quien originó el evento. Solo un
   * id: nunca datos personales de la clienta.
   */
  originUserId?: string;
}

/** Tope duro de la publicación: el realtime nunca puede frenar una cita. */
export const REALTIME_PUBLISH_TIMEOUT_MS = 2000;
/** Por encima de esto se deja un aviso en el log (publicación lenta). */
export const REALTIME_PUBLISH_SLOW_MS = 500;

@Injectable()
export class RealtimePublisherService {
  private readonly logger = new Logger(RealtimePublisherService.name);

  /**
   * Push to vyva-realtime-api. Best-effort: never throws and never takes
   * longer than {@link REALTIME_PUBLISH_TIMEOUT_MS}. Callers should `await`
   * it (in parallel with other work) so the Lambda does not freeze a
   * half-sent request.
   */
  async publishAppointmentChange(
    payload: RealtimeAppointmentPayload,
  ): Promise<void> {
    await this.publish(`business:${payload.idBusiness}`, 'appointment', payload);
  }

  private async publish(
    channel: string,
    type: string,
    data: unknown,
  ): Promise<void> {
    const url = process.env.REALTIME_PUBLISH_URL?.trim();
    const secret = process.env.REALTIME_PUBLISH_SECRET?.trim();
    if (!url || !secret) {
      return;
    }

    const startedAt = Date.now();
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify({
          channels: [channel],
          event: { type, data },
        }),
        signal: AbortSignal.timeout(REALTIME_PUBLISH_TIMEOUT_MS),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Realtime publish failed (${res.status}): ${body.slice(0, 200)}`,
        );
        return;
      }

      const elapsed = Date.now() - startedAt;
      if (elapsed > REALTIME_PUBLISH_SLOW_MS) {
        this.logger.warn(`Realtime publish slow: ${elapsed} ms`);
      }
    } catch (err) {
      const elapsed = Date.now() - startedAt;
      const e = err as { name?: string; message?: string } | undefined;
      const reason =
        e?.name === 'TimeoutError' || e?.name === 'AbortError'
          ? `timeout after ${REALTIME_PUBLISH_TIMEOUT_MS} ms`
          : (e?.message ?? String(err));
      this.logger.warn(`Realtime publish error (${elapsed} ms): ${reason}`);
    }
  }
}
