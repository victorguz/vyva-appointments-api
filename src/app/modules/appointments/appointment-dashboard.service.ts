import { Injectable } from '@nestjs/common';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import { User } from 'src/app/schemas/user.schema';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { AppointmentStatus } from '../../core/constants/domain.constants';
import { handleError } from '../../shared/error.functions';
import * as moment from 'moment';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
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
}
