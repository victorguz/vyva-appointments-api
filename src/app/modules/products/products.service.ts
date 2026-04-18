import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';
import { User } from 'src/app/schemas/user.schema';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Product, ProductKey } from '../../schemas/product.schema';
import { handleError } from '../../shared/error.functions';

@Injectable()
export class ProductsService {
  constructor(
    @InjectModel('Product')
    private readonly model: Model<Product, ProductKey>,
  ) {}

  async findOne(id: string, user: User): Promise<GenericResponse<Product>> {
    try {
      const product = await this.model
        .scan()
        .where('id')
        .eq(id)
        .where('idBusiness')
        .eq(user.idBusiness)
        .exec();
      if (!product || product.length === 0) {
        throw new Error('MS007');
      }
      return new GenericResponse(product[0].toJSON() as Product);
    } catch (error) {
      throw handleError(error);
    }
  }
}
