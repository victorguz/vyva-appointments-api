import { Injectable } from '@nestjs/common';
import { InjectModel, Model, TransactionSupport } from 'nestjs-dynamoose';
import { AppointmentStatus } from 'src/app/core/constants/domain.constants';
import { User } from 'src/app/schemas/user.schema';
import { v4 as uuidv4 } from 'uuid';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { handleError } from '../../shared/error.functions';
import { deleteEmptyProperties } from '../../shared/shared.functions';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import {
  CreateAppointmentDto,
  ListAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';
import { Product, ProductKey } from 'src/app/schemas/product.schema';
import { Business, BusinessKey } from 'src/app/schemas/business.schema';

@Injectable()
export class AppointmentsCustomerService extends TransactionSupport {
  constructor(
    private readonly lambdaInvokeService: LambdaInvokeService,
    @InjectModel('Appointment')
    private readonly model: Model<Appointment, AppointmentKey>,
    @InjectModel('Product')
    private readonly productModel: Model<Product, ProductKey>,
    @InjectModel('Business')
    private readonly businessModel: Model<Business, BusinessKey>,
  ) {
    super();
  }

  async findAllByCustomer(
    user?: User,
  ): Promise<GenericResponse<Appointment[]>> {
    try {
      if (!user || !user.id) {
        throw new Error('MS014');
      }

      // OPTIMIZACIÓN: Usar query con GSI customer-index en lugar de scan
      const customerQueryResult = await this.model
        .query('idCustomer')
        .using('customer-index')
        .eq(user.id)
        .exec();

      // Dynamose returns an array of Appointment (typed), otherwise type as Appointment[] to be explicit
      const appointments: Appointment[] = Array.isArray(customerQueryResult)
        ? customerQueryResult
        : [];

      // Use Maps to cache products and businesses by their ids. This avoids redundant fetches.
      const productCache: Map<string, Product | null> = new Map();
      const businessCache: Map<string, Business | null> = new Map();

      // For the final result
      const appointmentsWithProductAndBusiness: any[] = [];

      for (const appointment of appointments) {
        let product: Product | null = null;
        let business: Business | null = null;

        // Handle Product (idService)
        if (appointment.idService) {
          if (productCache.has(appointment.idService)) {
            product = productCache.get(appointment.idService) || null;
          } else {
            product = await this.productModel.get({
              id: appointment.idService,
            });
            productCache.set(appointment.idService, product || null);
          }
        }

        // Handle Business (idBusiness)
        if (product?.idBusiness) {
          if (businessCache.has(product.idBusiness)) {
            business = businessCache.get(product.idBusiness) || null;
          } else {
            business = await this.businessModel.get({
              id: product.idBusiness,
            });
            businessCache.set(product.idBusiness, business || null);
          }
        }

        appointmentsWithProductAndBusiness.push({
          ...appointment,
          service: product,
          business,
        });
      }
      return new GenericResponse(appointmentsWithProductAndBusiness as any[]);
    } catch (error) {
      throw handleError(error);
    }
  }

  async cancelCustomerAppointment(
    id: string,
    user: User,
  ): Promise<GenericResponse<Appointment>> {
    try {
      // Validate id and user
      if (!id) {
        throw new Error('MS014');
      }
      if (!user || !user.id) {
        throw new Error('MS014');
      }

      // Get the appointment to validate ownership
      const appointment = await this.model.get({ id });

      if (!appointment) {
        throw new Error('MS007');
      }

      // Validate that the appointment belongs to the customer
      if (appointment.idCustomer !== user.id) {
        throw new Error('MS007');
      }

      // Only allow canceling if appointment is not already canceled
      if (appointment.status === AppointmentStatus.canceled) {
        throw new Error('MS042'); // Appointment already canceled
      }

      // Update status to canceled
      const updateData: any = {
        status: AppointmentStatus.canceledByCustomer,
        modifiedBy: user.id,
      };

      await this.model.update({ id }, updateData);
      const updatedAppointment = await this.model.get({ id });

      if (!updatedAppointment) {
        throw new Error('MS007');
      }

      const appointmentData = updatedAppointment.toJSON() as Appointment;

      // Invoke Lambda to sync with Google Calendar asynchronously
      await this.lambdaInvokeService.invokeGoogleCalendarSync(
        appointmentData,
        'update',
      );

      return new GenericResponse(appointmentData);
    } catch (error) {
      throw handleError(error);
    }
  }
}
