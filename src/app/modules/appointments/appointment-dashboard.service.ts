import { Injectable } from '@nestjs/common';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import { User } from 'src/app/schemas/user.schema';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { AppointmentStatus } from '../../core/constants/domain.constants';
import { handleError } from '../../shared/error.functions';
import * as moment from 'moment';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { DashboardSingleCardItem } from '../../interfaces/dashboard.interface';
import { DateRangeReportDto } from './dto/appointments.dto';

@Injectable()
export class AppointmentDashboardService extends TransactionSupport {
  constructor(
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
    private readonly lambdaInvokeService: LambdaInvokeService,
  ) {
    super();
  }

  async scheduledCustomers(user: User): Promise<GenericResponse<number>> {
    try {
      const appointments = await this.model.query('idBusiness')
        .using('idBusiness-index').eq(user.idBusiness)
        .where('idCustomer').exists()
        .where('startDate').gt(moment().startOf('month').startOf('day').toDate().getTime())
        .where('startDate').lt(moment().endOf('month').endOf('day').toDate().getTime())
        .attributes(['idCustomer'])
        .exec();

      const uniqueCustomers = new Set(appointments.map((appointment) => appointment.idCustomer));
      return new GenericResponse(uniqueCustomers.size);
    } catch (error) {
      throw handleError(error);
    }
  }

  async appointmentsByStatus(
    dateRange: DateRangeReportDto,
    user: User,
  ): Promise<GenericResponse<{ [status: string]: number }>> {
    try {
      const statusCounts: { [status: string]: number } = {};

      const startDate = dateRange.startDate
        ? moment(dateRange.startDate).startOf('day').toDate()
        : moment().startOf('day').toDate();
      const endDate = dateRange.endDate
        ? moment(dateRange.endDate).endOf('day').toDate()
        : moment().endOf('day').toDate();

      // Count appointments by status directly in the database with date range
      const countPromises = Object.values(AppointmentStatus).map(async (status) => {
        const query = this.model.query('idBusiness')
          .using('idBusiness-index')
          .eq(user.idBusiness)
          .where('status').eq(status);

        // Add date range filter
        query.and()
          .where('startDate')
          .between(startDate.getTime(), endDate.getTime());

        const result = await query.count().exec();

        return { status, count: result.count ?? 0 };
      });

      const results = await Promise.all(countPromises);

      // Build the status counts object
      results.forEach(({ status, count }) => {
        statusCounts[status] = count;
      });

      return new GenericResponse(statusCounts);
    } catch (error) {
      throw handleError(error);
    }
  }

  async getOccupationPercentage(
    dateRange: { startDate: string; endDate: string },
    user: User,
  ): Promise<GenericResponse<DashboardSingleCardItem>> {
    try {
      // Validate idBusiness
      if (!user.idBusiness) {
        throw new Error('MS014');
      }

      const startDate = moment(dateRange.startDate).startOf('day');
      const endDate = moment(dateRange.endDate).endOf('day');

      // Limitar el rango de fechas a máximo 90 días para evitar timeouts
      const daysDiff = endDate.diff(startDate, 'days');
      if (daysDiff > 90) {
        endDate.subtract(daysDiff - 90, 'days');
      }


      // Calcular el período anterior con la misma duración (usar días en lugar de horas)
      const periodDurationDays = endDate.diff(startDate, 'days') + 1;
      const previousEndDate = moment(startDate).subtract(1, 'day');
      const previousStartDate = moment(previousEndDate).subtract(periodDurationDays - 1, 'days');

      // OPTIMIZACIÓN: Obtener activeTime domains y consultas a DynamoDB en paralelo
      const [activeTimeConfig, allCurrentAppointments, allPreviousAppointments] = await Promise.all([
        // Obtener horas activas desde domains API via Lambda invoke
        (async () => {
          try {
            const domainsPromise = this.lambdaInvokeService.invokeFunction(
              'vyva-domains',
              'GET',
              '/domains?group=activeTime&isActive=true',
              {},
              user,
            );

            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(() => reject(new Error('Domains API timeout')), 5000)
            );

            const domainsResponse = await Promise.race([
              domainsPromise,
              timeoutPromise,
            ]) as any;

            const activeTimeDomains = domainsResponse?.data || [];

            // Parsear el dominio activeTime
            let config: { [key: string]: { startTime: string; endTime: string } } = {};
            if (activeTimeDomains.length > 0) {
              const activeTimeDomain = activeTimeDomains[0];
              if (activeTimeDomain?.value) {
                try {
                  config = JSON.parse(activeTimeDomain.value);
                } catch (parseError) {
                  console.error('[getOccupationPercentage] Error parsing activeTime JSON:', parseError);
                }
              }
            }
            return config;
          } catch (error) {
            console.error('[getOccupationPercentage] Error fetching activeTime domains:', error);
            return {};
          }
        })(),
        // Consulta para período actual
        (async () => {
          try {
            const appointments = await Promise.race([
              this.model
                .query('idBusiness')
                .using('idBusiness-index')
                .eq(user.idBusiness)
                .and()
                .where('startDate')
                .between(startDate.toDate().getTime(), endDate.toDate().getTime())
                .where('status')
                .in([AppointmentStatus.pending, AppointmentStatus.confirmed, AppointmentStatus.completed])
                .limit(10000)
                .exec(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('DynamoDB query timeout')), 20000)
              ) as Promise<Appointment[]>,
            ]) as Appointment[];
            return appointments;
          } catch (error) {
            return [];
          }
        })(),
        // Consulta para período anterior
        (async () => {
          const startTime = Date.now();
          try {
            const appointments = await Promise.race([
              this.model
                .query('idBusiness')
                .using('idBusiness-index')
                .eq(user.idBusiness)
                .and()
                .where('startDate')
                .between(
                  previousStartDate.toDate().getTime(),
                  previousEndDate.toDate().getTime()
                )
                .where('status')
                .in([AppointmentStatus.pending, AppointmentStatus.confirmed, AppointmentStatus.completed])
                .limit(10000)
                .exec(),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error('DynamoDB query timeout')), 20000)
              ) as Promise<Appointment[]>,
            ]) as Appointment[];
            return appointments;
          } catch (error) {
            return [];
          }
        })(),
      ]);

      // OPTIMIZACIÓN: Pre-calcular minutos por día de la semana (cachear parsing)
      const dayMapping: { [key: number]: string } = {
        1: 'monday',
        2: 'tuesday',
        3: 'wednesday',
        4: 'thursday',
        5: 'friday',
        6: 'saturday',
        0: 'sunday',
      };

      const dayMinutesCache: { [key: string]: number } = {};
      Object.values(dayMapping).forEach((dayKey) => {
        const dayConfig = activeTimeConfig[dayKey];
        if (dayConfig && dayConfig.startTime && dayConfig.endTime) {
          try {
            const [startH, startM] = dayConfig.startTime.split(':').map(Number);
            const [endH, endM] = dayConfig.endTime.split(':').map(Number);
            if (
              !isNaN(startH) &&
              !isNaN(startM) &&
              !isNaN(endH) &&
              !isNaN(endM)
            ) {
              const startMinutes = startH * 60 + startM;
              const endMinutes = endH * 60 + endM;
              const dayActiveMinutes = endMinutes - startMinutes;
              if (dayActiveMinutes > 0) {
                dayMinutesCache[dayKey] = dayActiveMinutes;
              }
            }
          } catch (error) {
            console.error(`Error parsing time for ${dayKey}:`, dayConfig, error);
          }
        }
      });

      // OPTIMIZACIÓN: Función reutilizable para calcular minutos disponibles
      const calculateAvailableMinutes = (start: moment.Moment, end: moment.Moment): number => {
        let total = 0;
        const currentDay = moment(start);
        while (currentDay.isSameOrBefore(end, 'day')) {
          const dayOfWeek = currentDay.day();
          const dayKey = dayMapping[dayOfWeek];
          total += dayMinutesCache[dayKey] || 0;
          currentDay.add(1, 'day');
        }
        return total;
      };

      // Calcular minutos disponibles para ambos períodos
      const totalAvailableMinutes = calculateAvailableMinutes(startDate, endDate);
      const totalPreviousAvailableMinutes = calculateAvailableMinutes(previousStartDate, previousEndDate);

      // OPTIMIZACIÓN: Calcular minutos ocupados sin crear objetos moment innecesarios
      const calculateOccupiedMinutes = (appointments: Appointment[]): number => {
        return appointments.reduce((total, appointment) => {
          // Usar timestamps directamente en lugar de crear objetos moment
          const startTime = appointment.startDate instanceof Date
            ? appointment.startDate.getTime()
            : (typeof appointment.startDate === 'number' ? appointment.startDate : Number(appointment.startDate));
          const endTime = appointment.endDate instanceof Date
            ? appointment.endDate.getTime()
            : (typeof appointment.endDate === 'number' ? appointment.endDate : Number(appointment.endDate));
          const durationMs = endTime - startTime;
          return total + Math.round(durationMs / (1000 * 60)); // Convertir a minutos
        }, 0);
      };

      const totalOccupiedMinutes = calculateOccupiedMinutes(allCurrentAppointments);
      const previousOccupiedMinutes = calculateOccupiedMinutes(allPreviousAppointments);

      const currentOccupationPercentage = totalAvailableMinutes > 0
        ? (totalOccupiedMinutes / totalAvailableMinutes) * 100
        : 0;

      const previousOccupationPercentage = totalPreviousAvailableMinutes > 0
        ? (previousOccupiedMinutes / totalPreviousAvailableMinutes) * 100
        : 0;

      // Determinar la frecuencia basada en la duración del período
      const frequency = this.determineFrequencyWithMoment(startDate, endDate);

      

      const report: DashboardSingleCardItem = {
        title: 'Ocupación',
        description: `Porcentaje de ocupación del ${frequency.toLowerCase()}`,
        currentValue: Math.round(currentOccupationPercentage * 10) / 10, // Un decimal
        lastValue: Math.round(previousOccupationPercentage * 10) / 10,
        isCurrency: false,
        frequency: frequency.toLowerCase(),
      };

      console.log('[getOccupationPercentage] Returning report', report);
      return new GenericResponse(report);
    } catch (error) {
      throw handleError(error);
    }
  }

  private determineFrequencyWithMoment(
    startDate: moment.Moment,
    endDate: moment.Moment,
  ): string {
    const durationDays = endDate.diff(startDate, 'days') + 1;

    if (durationDays === 1) {
      return 'Día';
    } else if (durationDays <= 7) {
      return 'Semana';
    } else if (durationDays <= 31) {
      return 'Mes';
    } else if (durationDays <= 365) {
      return 'Año';
    } else {
      return 'Período';
    }
  }
}
