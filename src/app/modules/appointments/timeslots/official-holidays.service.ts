import { Injectable, Logger } from '@nestjs/common';

import { User } from '../../../schemas/user.schema';
import { LambdaInvokeService } from '../../shared/lambda-invoke.service';

/** Los festivos de un país no cambian en el día: se leen una vez y se reutilizan. */
const CACHE_MS = 12 * 3600 * 1000;
/** Si no se pudieron leer, no se vuelve a intentar en cada consulta de horas libres. */
const FAILURE_CACHE_MS = 5 * 60 * 1000;

interface Cached {
  at: number;
  ttl: number;
  dates: Set<string>;
}

/**
 * Los festivos OFICIALES del país del negocio, para que la agenda no ofrezca horas esos días cuando el negocio
 * lo pide (`closedOnHolidays` en su horario de atención, grupo `activeTime`).
 *
 * El país sale de la ubicación elegida en «Mi negocio» y el calendario, de los festivos públicos de Google que ya
 * lee el servicio de integraciones: aquí solo se le pide el rango. Solo cuentan los de clase `holiday` (festivo
 * oficial): ni las celebraciones, donde se trabaja con normalidad, ni los festivos de una sola región.
 *
 * Si no se pueden leer, devuelve un conjunto vacío y deja el rastro en el log: la agenda sigue ofreciendo horas
 * (como antes) en lugar de quedarse sin ofrecer ninguna por una falla de un tercero.
 */
@Injectable()
export class OfficialHolidaysService {
  private readonly logger = new Logger(OfficialHolidaysService.name);
  private readonly cache = new Map<string, Cached>();

  constructor(private readonly lambdaInvoke: LambdaInvokeService) {}

  /** Las fechas locales (`YYYY-MM-DD`) de festivo oficial entre `from` y `to`, ambas incluidas. */
  async officialDates(idBusiness: string, from: string, to: string): Promise<Set<string>> {
    const key = `${idBusiness}|${from}|${to}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < cached.ttl) return cached.dates;

    let dates = new Set<string>();
    let ttl = CACHE_MS;
    try {
      const response = await this.lambdaInvoke.invokeFunction(
        'vyva-integrations',
        'GET',
        '/api/integrations/google-calendar/holidays',
        undefined,
        { id: 'agenda', idBusiness, role: 'admin' } as unknown as User,
        { from, to },
      );
      const holidays = (response?.data?.holidays ?? []) as Array<{ date?: string; kind?: string }>;
      dates = new Set(
        holidays
          .filter((holiday) => holiday?.kind === 'holiday' && /^\d{4}-\d{2}-\d{2}$/.test(holiday.date ?? ''))
          .map((holiday) => holiday.date as string),
      );
    } catch (err) {
      ttl = FAILURE_CACHE_MS;
      this.logger.warn(
        `No pude leer los festivos de ${idBusiness} (${from} a ${to}); la agenda no los cierra: ${(err as Error)?.message ?? err}`,
      );
    }

    this.cache.set(key, { at: Date.now(), ttl, dates });
    return dates;
  }
}
