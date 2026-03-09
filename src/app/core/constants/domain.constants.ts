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
  admin = 'admin',
  employee = 'employee',
  customer = 'customer',
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
  confirmed = 'confirmed',
  canceled = 'canceled',
  completed = 'completed',
  canceledByCustomer = 'canceledByCustomer',
  timeOut = 'timeOut',
}
