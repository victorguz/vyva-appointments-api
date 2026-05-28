import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { User } from 'src/app/schemas/user.schema';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Customer, CustomerKey } from '../../schemas/customer.schema';
@Injectable()
export class CustomersService {
  constructor(
    @InjectModel('Customer')
    private readonly model: Model<Customer, CustomerKey>,
  ) {}

  async findOne(id: string, user: User): Promise<GenericResponse<Customer>> {
    try {
      const customer = await this.model.get({ id });
      if (!customer) {
        throw new Error('MS007');
      }
      return new GenericResponse(customer.toJSON() as Customer);
    } catch (error) {
      throw error;
    }
  }
}

