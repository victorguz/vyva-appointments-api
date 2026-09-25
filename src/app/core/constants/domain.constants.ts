export enum UserDocumentType {
  CC = 'CC',
  TI = 'TI',
  CE = 'CE',
  PP = 'PP',
}

export enum UserGender {
  M = 'M',
  F = 'F',
}
export enum UserRole {
  superadmin = 'superadmin',
  supermarketing = 'supermarketing',
  admin = 'admin',
  employee = 'employee',
  customer = 'customer',
}

/** Roles de plataforma que pueden operar con idBusiness del JWT/edge context. */
export const PLATFORM_CROSS_BUSINESS_ROLES: UserRole[] = [
  UserRole.superadmin,
  UserRole.supermarketing,
];

export function isPlatformCrossBusinessRole(
  role?: string | null,
): boolean {
  return PLATFORM_CROSS_BUSINESS_ROLES.includes(role as UserRole);
}

export enum PaymentMethodType {
  cash = 'cash',
  transfer = 'transfer',
  card = 'card',
  pse = 'pse',
}

export enum MeasurementUnits {
  und = 'und',
  ml = 'ml',
  l = 'l',
  g = 'g',
  kg = 'kg',
  cm = 'cm',
  m = 'm',
  day = 'day',
  minute = 'minute',
  hour = 'hour',
}

export enum MembershipDurations {
  oneDay = '1',
  oneMonth = '30',
  threeMonths = '90',
  sixMonths = '180',
  oneYear = '365',
  other = 'Otro',
}

export enum ProductStatus {
  published = 'published',
  draft = 'draft',
  deleted = 'deleted',
}

export enum SalesOrderStatus {
  pending = 'pending',
  partiallyPaid = 'partiallyPaid',
  paid = 'paid',
  canceled = 'canceled',
}

export enum AppointmentStatus {
  pending = 'pending',
  web = 'web',
  /**
   * La agendó el asistente por WhatsApp.
   *
   * Estado propio, como `web`, y no `pending` a secas: quien abre la agenda
   * tiene que ver de un vistazo cuáles hay que comprobar, porque el pago lo
   * recibió el bot y el comprobante todavía no lo ha mirado nadie.
   */
  bot = 'bot',
  confirmed = 'confirmed',
  canceled = 'canceled',
  completed = 'completed',
  canceledByCustomer = 'canceledByCustomer',
  timeOut = 'timeOut',
}
