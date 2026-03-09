import { HttpException, HttpStatus } from "@nestjs/common";
import {
  HANDLED_ERRORS,
  ERROR_MESSAGES,
} from "../core/constants/error.constants";
import { GenericResponse } from "../core/interfaces/generic-response.interface";
import { isProduction } from "../core/config/environment.config";

export function handleError(
  error: any,
  httpStatus?: HttpStatus
): HttpException {
  let code: string = "MS027";
  let message: string = ERROR_MESSAGES.MS027;
  let status: HttpStatus = HttpStatus.INTERNAL_SERVER_ERROR;
  let handledError = false;

  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    (error as any).response?.handledError === true
  ) {
    const resp = (error as any).response;
    code = typeof resp.code === "string" ? resp.code : code;
    message = typeof resp.message === "string" ? resp.message : message;
    status = typeof resp.status === "number" ? resp.status : status;
    handledError = true;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as { message?: unknown }).message === "string"
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
    }
    // Si no está manejado, se mantiene MS027 por defecto
  } else if (typeof error === "string") {
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
    }
    // Si no está manejado, se mantiene MS027 por defecto
  }

  // Log del error real - usar console para que aparezca en CloudWatch
  const errorMessage =
    typeof error === "string"
      ? error
      : (error as any)?.message || JSON.stringify(error);

  const errorType =
    typeof error === "string"
      ? error
      : (error as any)?.code || (error as any)?.error || "Unknown error";

  // Extraer el stacktrace y convertirlo en array
  const stackTraceString = (error as any)?.stack || new Error().stack || "No stack trace available";
  const stackTraceArray = typeof stackTraceString === 'string'
    ? stackTraceString.split('\n').filter(line => line.trim() !== '')
    : [String(stackTraceString)];

  // Intentar serializar el error original de forma segura
  let originalError: any;
  try {
    if (typeof error === "object" && error !== null) {
      originalError = JSON.stringify(error, Object.getOwnPropertyNames(error));
    } else {
      originalError = error;
    }
  } catch (e) {
    originalError = String(error);
  }

  const errorDetails = {
    originalError,
    type: errorType,
    message: errorMessage,
    handledError,
    finalCode: code,
    finalStatus: status,
    environment: isProduction ? 'production' : 'development',
  };

  // Unificar todo en un solo log - usar console.error con múltiples argumentos para mostrar el array correctamente
  console.error(
    `[handleError] ${isProduction ? 'Error en producción' : 'Error'}: ${errorType} - ${errorMessage}`,
    errorDetails,
    '[handleError] Stacktrace:',
    stackTraceArray
  );

  // Si el error no fue manejado, siempre usar MS027
  if (!handledError) {
    code = "MS027";
    message = ERROR_MESSAGES.MS027;
    status = HttpStatus.INTERNAL_SERVER_ERROR;
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
