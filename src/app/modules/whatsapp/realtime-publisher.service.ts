import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class RealtimePublisherService {
  private readonly logger = new Logger(RealtimePublisherService.name);

  /** Best-effort push to vyva-realtime-api (never throws). */
  async publish(
    idBusiness: string,
    type: string,
    data: unknown,
  ): Promise<void> {
    const url = process.env.REALTIME_PUBLISH_URL?.trim();
    const secret = process.env.REALTIME_PUBLISH_SECRET?.trim();
    if (!url || !secret) {
      return;
    }

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-secret': secret,
        },
        body: JSON.stringify({
          channels: [`whatsapp:${idBusiness}`],
          event: { type, data },
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.warn(
          `Realtime publish failed (${res.status}): ${body.slice(0, 200)}`,
        );
      }
    } catch (err) {
      this.logger.warn(
        `Realtime publish error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }
}
