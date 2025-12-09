import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import {
  HANDLED_ERRORS,
  ERROR_MESSAGES,
} from '../core/constants/error.constants';
import { GenericResponse } from '../core/interfaces/generic-response.interface';
import { isProduction } from '../core/config/environment.config';

export function handleError(error: any, httpStatus?: HttpStatus): HttpException {
  const logger = new Logger(handleError.name);

  let code: string = 'MS027';
  let message: string = ERROR_MESSAGES.MS027;
  let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  let handledError = false;

  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error &&
    (error as any).response?.handledError === true
  ) {
    const resp = (error as any).response;
    code = typeof resp.code === 'string' ? resp.code : code;
    message = typeof resp.message === 'string' ? resp.message : message;
    status = typeof resp.status === 'number' ? resp.status : status;
    handledError = true;
  } else if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const msg = (error as { message: string }).message;
    const found = HANDLED_ERRORS.find((val) => msg.includes(val.keyword));
    if (found) {
      code = found.code;
      message = ERROR_MESSAGES[found.code];
      status = found.status;
      handledError = true;
    } else if ((ERROR_MESSAGES as any)[msg]) {
      code = msg;
      message = (ERROR_MESSAGES as any)[msg];
      status = httpStatus ?? HttpStatus.BAD_REQUEST;
      handledError = true;
    } else {
      message = msg;
      status = httpStatus ?? HttpStatus.BAD_REQUEST;
    }
  } else if (typeof error === 'string') {
    const found = HANDLED_ERRORS.find((val) => error.includes(val.keyword));
    if (found) {
      code = found.code;
      message = ERROR_MESSAGES[found.code];
      status = found.status;
      handledError = true;
    } else if ((ERROR_MESSAGES as any)[error]) {
      code = error;
      message = (ERROR_MESSAGES as any)[error];
      status = httpStatus ?? HttpStatus.BAD_REQUEST;
      handledError = true;
    } else {
      message = error;
      status = httpStatus ?? HttpStatus.BAD_REQUEST;
    }
  }

  if (!isProduction) {
    logger.error(`Handled Error: ${message}`, (error as any)?.stack);
  }

  const response = new GenericResponse<any>(
    undefined,
    false,
    message,
    handledError,
    code,
    status
  );
  return new HttpException(response, status);
}
