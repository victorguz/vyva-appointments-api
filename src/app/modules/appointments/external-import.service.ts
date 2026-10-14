import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { v4 as uuidv4 } from 'uuid';

import { AppointmentStatus } from '../../core/constants/domain.constants';
import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { User, UserKey } from '../../schemas/user.schema';
import { RealtimePublisherService } from '../shared/realtime-publisher.service';
import {
  ExternalEventItemDto,
  ImportExternalAppointmentsDto,
} from './dto/appointments.dto';

export const EXTERNAL_SOURCE_GOOGLE = 'google';
export const EXTERNAL_CHANNEL = 'google-import';

export interface ExternalImportResult {
  /** Bloqueos creados en la agenda. */
  created: number;
  /** Ya estaban de una importación anterior: no se tocan ni se repiten. */
  duplicates: number;
  /** El evento ya empezó o tiene un horario inválido: solo se importa lo que viene. */
  past: number;
  /** El empleado no es de este negocio. */
  invalidEmployee: number;
}

/** Cuántos bloqueos se crean a la vez. */
const CREATE_CONCURRENCY = 10;

/**
 * Trae a la agenda los eventos FUTUROS de un calendario externo (hoy Google
 * Calendar) como bloqueos de cada empleado. Es una migración que solo suma:
 *
 * - No borra ni modifica nada de lo que ya hay en la agenda.
 * - Repetirla no duplica: cada bloqueo guarda de qué evento viene
 *   (`externalId`), y uno que ya está se salta.
 * - Cada evento queda como un bloqueo `timeOut` (no una cita), que ocupa el
 *   horario del empleado pero no cuenta como cita ni como venta en los reportes.
 * - No se sincroniza de vuelta a Google: el evento ya vive allí.
 */
@Injectable()
export class ExternalImportService {
  constructor(
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
    @InjectModel('User')
    private readonly userModel: Model<User, UserKey>,
    private readonly realtimePublisher: RealtimePublisherService,
  ) {}

  /** Identidad estable del evento externo para un empleado. */
  static externalId(item: ExternalEventItemDto): string {
    return `${EXTERNAL_SOURCE_GOOGLE}:${item.sourceCalendarId}:${item.sourceEventId}:${item.idEmployee}`;
  }

  async importBatch(
    dto: ImportExternalAppointmentsDto,
    user: User,
  ): Promise<GenericResponse<ExternalImportResult>> {
    const idBusiness = user.idBusiness?.trim();
    if (!idBusiness) {
      throw new Error('MS007');
    }

    const result: ExternalImportResult = {
      created: 0,
      duplicates: 0,
      past: 0,
      invalidEmployee: 0,
    };
    const now = Date.now();

    // Solo lo que empieza en el futuro y tiene un horario válido.
    const upcoming = (dto.items ?? []).filter((item) => {
      const start = new Date(item.startDate).getTime();
      const end = new Date(item.endDate).getTime();
      const ok = Number.isFinite(start) && Number.isFinite(end) && start > now && end > start;
      if (!ok) result.past++;
      return ok;
    });
    if (!upcoming.length) {
      return new GenericResponse(result);
    }

    // Cada empleado debe ser de este negocio.
    const employees = new Map<string, User | null>();
    for (const idEmployee of new Set(upcoming.map((i) => i.idEmployee))) {
      const found = await this.userModel.get({ id: idEmployee });
      const row = found?.toJSON() as User | undefined;
      employees.set(idEmployee, row && row.idBusiness === idBusiness ? row : null);
    }

    const existing = await this.existingExternalIds(idBusiness);

    const toCreate: Appointment[] = [];
    for (const item of upcoming) {
      const employee = employees.get(item.idEmployee);
      if (!employee) {
        result.invalidEmployee++;
        continue;
      }
      const externalId = ExternalImportService.externalId(item);
      if (existing.has(externalId)) {
        result.duplicates++;
        continue;
      }
      existing.add(externalId);
      toCreate.push({
        id: uuidv4(),
        startDate: new Date(item.startDate),
        endDate: new Date(item.endDate),
        idEmployee: item.idEmployee,
        employeeName: employee.name?.trim() || undefined,
        status: AppointmentStatus.timeOut,
        idBusiness,
        createdBy: user.id,
        channel: EXTERNAL_CHANNEL,
        customerName: item.title.trim().slice(0, 200),
        serviceName: '',
        notes: item.description?.trim().slice(0, 1000) || undefined,
        services: [],
        externalSource: EXTERNAL_SOURCE_GOOGLE,
        externalId,
      } as Appointment);
    }

    for (let i = 0; i < toCreate.length; i += CREATE_CONCURRENCY) {
      const chunk = toCreate.slice(i, i + CREATE_CONCURRENCY);
      await Promise.all(chunk.map((row) => this.model.create(this.clean(row))));
      result.created += chunk.length;
    }

    for (const row of toCreate) {
      void this.realtimePublisher.publishAppointmentChange({
        idBusiness,
        action: 'created',
        appointmentId: row.id,
        startDate: new Date(row.startDate).toISOString(),
        endDate: new Date(row.endDate).toISOString(),
      });
    }

    return new GenericResponse(result);
  }

  /** Ids externos que el negocio ya tiene en su agenda (solo de hoy en adelante). */
  private async existingExternalIds(idBusiness: string): Promise<Set<string>> {
    const rows = await this.model
      .query('idBusiness')
      .eq(idBusiness)
      .filter('externalSource')
      .eq(EXTERNAL_SOURCE_GOOGLE)
      .all()
      .exec();
    return new Set(
      rows
        .map((row) => (row.toJSON() as Appointment).externalId)
        .filter((id): id is string => !!id),
    );
  }

  private clean(row: Appointment): Appointment {
    return Object.fromEntries(
      Object.entries(row).filter(([, v]) => v !== undefined),
    ) as unknown as Appointment;
  }
}
