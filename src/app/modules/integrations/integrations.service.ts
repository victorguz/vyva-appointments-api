import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { User } from 'src/app/schemas/user.schema';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Product, ProductKey } from '../../schemas/product.schema';
import { handleError } from '../../shared/error.functions';
import { Appointment } from 'src/app/schemas/appointment.schema';

@Injectable()
export class IntegrationsService {
  constructor(private http: HttpService) {}

  async createCalendarEvent(
    appointment: Appointment,
    user: User,
  ): Promise<GenericResponse<any>> {
    try {
      const result = await this.http.post("");
      return new GenericResponse(result);
    } catch (error) {
      throw handleError(error);
    }
  }
}
