import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InvocationType, InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

import { AppointmentStatus } from '../../core/constants/domain.constants';
import { Appointment } from '../../schemas/appointment.schema';

/**
 * Estados que no son una cita de alguien: los huecos bloqueados y las que
 * nacen ya canceladas no dicen nada de un anuncio.
 */
const NOT_A_BOOKING = new Set<string>([
  AppointmentStatus.timeOut,
  AppointmentStatus.canceled,
  AppointmentStatus.canceledByCustomer,
]);

/**
 * Avisa a vyva-whatsapp-api de que alguien agendó, por si venía de un anuncio.
 *
 * Solo se llama al crear la cita: cambiarle el estado, moverla o cancelarla no
 * es agendar, y Meta no quita duplicados. Aquí no se sabe si hubo anuncio —eso
 * lo sabe el chat—, así que se avisa de toda cita con cliente y es WhatsApp
 * quien decide. Sin esperar: si falla, la cita sigue igual.
 */
@Injectable()
export class AdConversionDispatchService {
  private readonly logger = new Logger(AdConversionDispatchService.name);
  private readonly lambdaClient: LambdaClient;

  constructor(private readonly configService: ConfigService) {
    const region = this.configService.get<string>('REGION') || 'us-east-1';
    this.lambdaClient = new LambdaClient({ region });
  }

  async appointmentBooked(appointment: Appointment): Promise<void> {
    const idCustomer = appointment?.idCustomer?.trim();
    const idBusiness = appointment?.idBusiness?.trim();
    if (!idCustomer || !idBusiness || !appointment.id) {
      return;
    }
    if (NOT_A_BOOKING.has(String(appointment.status ?? ''))) {
      return;
    }

    try {
      const stage = this.configService.get<string>('NODE_ENV') || 'qas';
      await this.lambdaClient.send(
        new InvokeCommand({
          FunctionName: `vyva-whatsapp-${stage}-adConversion`,
          InvocationType: InvocationType.Event,
          Payload: Buffer.from(
            JSON.stringify({
              kind: 'appointment',
              idBusiness,
              idCustomer,
              sourceId: appointment.id,
              occurredAt: Date.now(),
            }),
          ),
        }),
      );
    } catch (error) {
      this.logger.warn(
        `No se pudo avisar la cita ${appointment.id} a conversiones: ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }
}
