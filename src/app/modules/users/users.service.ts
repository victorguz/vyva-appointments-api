import { Injectable } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { User, UserKey } from '../../schemas/user.schema';
import { handleError } from '../../shared/error.functions';
import { UserRole } from 'src/app/core/constants/domain.constants';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel('User')
    private readonly model: Model<User, UserKey>,
  ) {}

  async findOne(
    id: string,
    currentUser?: User,
  ): Promise<GenericResponse<User>> {
    try {
      const user = await this.model.scan().where('id').eq(id).exec();
      if (!user || user.length === 0) {
        throw new Error('MS007');
      }
      const userData = user[0].toJSON() as User;
      delete userData.password;
      return new GenericResponse(userData);
    } catch (error) {
      throw handleError(error);
    }
  }

  async findEmployees(idBusiness: string): Promise<GenericResponse<User[]>> {
    try {
      const users = await this.model
        .query('idBusiness')
        .eq(idBusiness)
        .where('role')
        .eq(UserRole.employee)
        .where('status')
        .eq(true)
        .exec();
      return new GenericResponse(users);
    } catch (error) {
      throw handleError(error);
    }
  }
}
