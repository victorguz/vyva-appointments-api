import { HttpException, HttpStatus, Logger } from '@nestjs/common';
import {
  HANDLED_ERRORS,
  ERROR_MESSAGES,
} from '../core/constants/error.constants';
import { GenericResponse } from '../core/interfaces/generic-response.interface';
import { isProduction } from '../core/config/environment.config';

export function handleError(error: any, httpStatus?: HttpStatus) {
  const logger = new Logger(handleError.name);

  if (!isProduction) {
    const message = (ERROR_MESSAGES as any)[error.message];
    logger.error('Handled Error: ' + (message ?? error.message), error.stack);
  }
  if (error.response?.handledError == true) {
    return new HttpException(error.response, error.response.status);
  } else if (error.message) {
    return findHandledError(error.message, httpStatus);
  } else if (typeof error == 'string') {
    return findHandledError(error, httpStatus ?? HttpStatus.BAD_REQUEST);
  }
}

export function findHandledError(
  error: string,
  httpStatus: HttpStatus,
): HttpException {
  const message = (ERROR_MESSAGES as any)[error];
  if (message) {
    return new HttpException(
      new GenericResponse<any>(undefined, false, message, true, error),
      httpStatus ?? HttpStatus.BAD_REQUEST,
    );
  }
  const find = HANDLED_ERRORS.find((val) => error.includes(val.keyword));
  if (find) {
    return new HttpException(
      new GenericResponse<any>(
        undefined,
        false,
        ERROR_MESSAGES[find.code],
        true,
        find.code,
        find.status,
      ),
      httpStatus ?? find.status,
    );
  } else {
    return new HttpException(
      new GenericResponse<any>(
        undefined,
        false,
        ERROR_MESSAGES.MS027,
        false,
        'MS027',
        HttpStatus.INTERNAL_SERVER_ERROR,
      ),
      500,
    );
  }
}

export function findHandledErrorMessage(error: string): string {
  const find = HANDLED_ERRORS.find((val) => val.keyword == error);
  return find ? ERROR_MESSAGES[find.code] : error;
}
