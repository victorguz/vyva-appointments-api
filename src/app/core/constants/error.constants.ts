import { HttpStatus } from '@nestjs/common';

export enum ERROR_MESSAGES {
  MS001 = 'Usuario creado exitosamente.',
  MS002 = 'Acceso concedido.',
  MS003 = 'Consulta realizada con éxito.',
  MS004 = 'Este tipo y número de documento ya está registrado.',
  MS005 = 'Este correo electrónico ya está registrado.',
  MS006 = 'Por favor, ingresa al menos un nombre o número de identificación para realizar la búsqueda.',
  MS007 = 'No se encontró ningún registro con los datos proporcionados.',
  MS008 = 'No hay información nueva para actualizar.',
  MS009 = 'El nombre de la membresía ya está registrado.',
  MS010 = 'Stock insuficiente para este producto.',
  MS011 = 'Solo puedes anular esta transacción una vez.',
  MS012 = 'Este ítem no es de tipo "Membresía".',
  MS013 = 'No se pueden anular transacciones realizadas hace más de 30 días.',
  MS014 = 'Solicitud incorrecta, por favor revisa los datos ingresados.',
  MS015 = 'Este "link" ya está en uso. Recuerda que debe ser único para cada negocio.',
  MS016 = 'El usuario no está registrado.',
  MS017 = 'Usuario o contraseña incorrectos.',
  MS018 = '',
  MS019 = 'No tienes permisos para acceder a esta sección.',
  MS020 = 'Por favor, ingresa un nombre.',
  MS021 = 'Este usuario no tiene suscripciones activas.',
  MS022 = 'No hay productos asociados a la transacción.',
  MS023 = 'Por políticas administrativas, este usuario no tiene acceso permitido.',
  MS024 = 'La suscripción del usuario ha expirado.',
  MS025 = 'La suscripción del usuario aún no ha comenzado.',
  MS026 = 'La suscripción del usuario ha sido anulada.',
  MS027 = 'Error inesperado en el servidor. Por favor, inténtalo más tarde.',
  MS028 = 'Asigne un cliente a la compra para habilitar la suscripción.',
  MS029 = 'Por favor, selecciona un entrenador.',
  MS030 = 'El correo electrónico no puede exceder los 100 caracteres.',
  MS031 = 'El formato de este correo electrónico no es válido.',
  MS032 = 'El usuario necesita estar asociado a una negocio.',
  MS033 = 'El usuario necesita estar asociado a una establecimiento.',
  MS034 = 'Se debe especificar un usuario responsable de la actualización.',
  MS035 = 'La suscripción del usuario está próxima a terminar.',
  MS036 = 'Los métodos de pago deben cubrir el valor de la compra.',
  MS037 = 'Al registrar el inventario solo se aceptan números positivos.',
  MS038 = 'El registro no se puede actualizar.',
  MS039 = 'El negocio no existe.',
  MS040 = 'El establecimiento no existe.',
}

export const HANDLED_ERRORS: {
  keyword: string;
  code: keyof typeof ERROR_MESSAGES;
  status: HttpStatus;
}[] = [
  {
    keyword: 'Companies_slug_key',
    code: 'MS015',
    status: HttpStatus.BAD_REQUEST,
  },
  {
    keyword: 'uk_user_document_company',
    code: 'MS004',
    status: HttpStatus.BAD_REQUEST,
  },
  {
    keyword: 'uk_user_email',
    code: 'MS005',
    status: HttpStatus.BAD_REQUEST,
  },
  {
    keyword: 'MS016',
    code: 'MS016',
    status: HttpStatus.NOT_FOUND,
  },
  {
    keyword: 'MS018',
    code: 'MS018',
    status: HttpStatus.UNAUTHORIZED,
  },
  {
    keyword: 'MS019',
    code: 'MS019',
    status: HttpStatus.UNAUTHORIZED,
  },

  {
    keyword: 'MS007',
    code: 'MS007',
    status: HttpStatus.NOT_FOUND,
  },
  {
    keyword: 'MS023',
    code: 'MS023',
    status: HttpStatus.NOT_ACCEPTABLE,
  },
  {
    keyword: 'MS024',
    code: 'MS024',
    status: HttpStatus.NOT_ACCEPTABLE,
  },
  {
    keyword: 'MS025',
    code: 'MS025',
    status: HttpStatus.NOT_ACCEPTABLE,
  },
  {
    keyword: 'MS026',
    code: 'MS026',
    status: HttpStatus.NOT_ACCEPTABLE,
  },
  {
    keyword: 'MS027',
    code: 'MS027',
    status: HttpStatus.INTERNAL_SERVER_ERROR,
  },
];
