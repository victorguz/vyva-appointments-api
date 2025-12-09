import { ApiProperty } from '@nestjs/swagger';
import { ERROR_MESSAGES } from '../constants/error.constants';
import { HttpStatus } from '@nestjs/common';

export interface IGenericResponse<T> {
  success: boolean;
  message: string;
  data?: T;
}

export class GenericResponse<T> implements IGenericResponse<T> {
  @ApiProperty()
  success: boolean = true;
  @ApiProperty()
  message: string = ERROR_MESSAGES.MS003;
  @ApiProperty()
  data?: T;
  @ApiProperty()
  handledError?: boolean;
  @ApiProperty()
  code?: string;
  @ApiProperty()
  status?: HttpStatus;

  constructor(
    data: T,
    success: boolean = true,
    message: string = ERROR_MESSAGES.MS003,
    handledError?: boolean,
    code?: string,
    status?: HttpStatus,
  ) {
    this.success = success;
    this.message = message;
    this.data = data;
    this.handledError = handledError;
    this.code = code;
    this.status = status ?? (success ? HttpStatus.OK : HttpStatus.BAD_REQUEST);
  }
}
