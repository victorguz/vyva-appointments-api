import { ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import { AppointmentStatus } from '../../../core/constants/domain.constants';

export class AppointmentServiceDto {
  @ApiProperty({ description: 'Service ID' })
  @IsString()
  @IsNotEmpty()
  id: string;

  @ApiProperty({ description: 'Service name' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ description: 'Service price' })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiProperty({ description: 'Service offer price' })
  @IsNumber()
  @IsOptional()
  offerPrice?: number;

  @ApiProperty({ description: 'Service duration in minutes' })
  @IsNumber()
  @IsOptional()
  measure?: number;
}

export class AdditionalSessionDto {
  @ApiProperty({ description: 'Session start date and time' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ description: 'Session end date and time' })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;
}

export class CreatePublicAppointmentDto {
  @ApiProperty({ description: 'Appointment start date and time' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ description: 'Appointment end date and time' })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @ApiProperty({ description: 'Service ID' })
  @IsString()
  @IsNotEmpty()
  idService: string;

  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsNotEmpty()
  idCustomer: string;

  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsOptional()
  idEmployee?: string;

  @ApiProperty({ description: 'Order ID' })
  @IsString()
  @IsOptional()
  idOrder: string;

  @ApiProperty({
    description: 'Order IDs linked to the appointment',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  idOrderList?: string[];

  @ApiProperty({
    description: 'Appointment status',
    enum: AppointmentStatus,
    default: AppointmentStatus.pending,
  })
  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Business Info ID (for public appointments)' })
  @IsString()
  @IsOptional()
  idBusiness?: string;

  @ApiProperty({ description: 'Notes / observations for the appointment' })
  @IsString()
  @IsOptional()
  notes?: string;
}

export class CreateAppointmentDto {
  @ApiProperty({ description: 'Appointment ID' })
  @IsString()
  @IsOptional()
  id?: string;

  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsOptional()
  idCustomer?: string;

  @ApiProperty({ description: 'Customer name (cached)' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiProperty({ description: 'Appointment start date and time' })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({ description: 'Appointment end date and time' })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @ApiProperty({ description: 'Service ID (for backwards compatibility)' })
  @IsString()
  @IsOptional()
  idService?: string;

  @ApiProperty({
    description: 'Cached full public names of the services',
  })
  @IsString()
  @IsOptional()
  serviceName?: string;

  @ApiProperty({ description: 'Employee name' })
  @IsString()
  @IsOptional()
  employeeName?: string;

  @ApiProperty({ description: 'Notes / observations for the appointment' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'Array of services',
    type: [AppointmentServiceDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppointmentServiceDto)
  @IsOptional()
  services?: AppointmentServiceDto[];

  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsOptional()
  idEmployee?: string;

  @ApiProperty({ description: 'Order ID' })
  @IsString()
  @IsOptional()
  idOrder: string;

  @ApiProperty({
    description: 'Order IDs linked to the appointment',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  idOrderList?: string[];

  @ApiProperty({
    description: 'Appointment status',
    enum: AppointmentStatus,
    default: AppointmentStatus.pending,
  })
  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Business Info ID (for public appointments)' })
  @IsString()
  @IsOptional()
  idBusiness?: string;

  @ApiProperty({ description: 'Google Calendar ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarId?: string;

  @ApiProperty({ description: 'Google Calendar Event ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarEventId?: string;

  @ApiProperty({ description: 'Google Calendar Employee Event ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarEmployeeEventId?: string;

  @ApiProperty({ description: 'Google Calendar Customer Event ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarCustomerEventId?: string;

  @ApiProperty({
    description:
      'If true, send Google Calendar invite to the customer; if false, only the assigned employee receives an invite.',
  })
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) =>
    value === true || value === 'true' || value === 1 || value === '1'
      ? true
      : value === false || value === 'false' || value === 0 || value === '0'
        ? false
        : value,
  )
  sendGoogleCalendar?: boolean;

  @ApiProperty({
    description: 'Additional sessions for multi-session appointments',
    type: [AdditionalSessionDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AdditionalSessionDto)
  additionalSessions?: AdditionalSessionDto[];
}
export class UpdateAppointmentDto {
  @ApiProperty({ description: 'Appointment start date and time' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ description: 'Appointment end date and time' })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiProperty({ description: 'Service ID (for backwards compatibility)' })
  @IsString()
  @IsOptional()
  idService?: string;

  @ApiProperty({ description: 'Customer name (cached)' })
  @IsString()
  @IsOptional()
  customerName?: string;

  @ApiProperty({ description: 'Employee name (cached)' })
  @IsString()
  @IsOptional()
  employeeName?: string;

  @ApiProperty({ description: 'Notes / observations for the appointment' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiProperty({
    description: 'Cached full public names of the services',
  })
  @IsString()
  @IsOptional()
  serviceName?: string;

  @ApiProperty({
    description: 'Array of services',
    type: [AppointmentServiceDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AppointmentServiceDto)
  @IsOptional()
  services?: AppointmentServiceDto[];

  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsOptional()
  idCustomer?: string;

  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  @IsOptional()
  idEmployee?: string;

  @ApiProperty({ description: 'Order ID' })
  @IsString()
  @IsOptional()
  idOrder?: string;

  @ApiProperty({
    description: 'Order IDs linked to the appointment',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  idOrderList?: string[];

  @ApiProperty({
    description: 'Appointment status',
    enum: AppointmentStatus,
  })
  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Modified by user ID' })
  @IsString()
  @IsOptional()
  modifiedBy?: string;

  @ApiProperty({ description: 'Google Calendar ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarId?: string;

  @ApiProperty({ description: 'Google Calendar Event ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarEventId?: string;

  @ApiProperty({ description: 'Google Calendar Employee Event ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarEmployeeEventId?: string;

  @ApiProperty({ description: 'Google Calendar Customer Event ID (if linked)' })
  @IsString()
  @IsOptional()
  googleCalendarCustomerEventId?: string;
}

export class ListAppointmentDto {
  @ApiProperty({ description: 'Order ID filter' })
  @IsString()
  @IsOptional()
  idOrder?: string;

  @ApiProperty({ description: 'Parent appointment ID filter' })
  @IsString()
  @IsOptional()
  idParent?: string;

  @ApiProperty({ description: 'Customer ID filter' })
  @IsString()
  @IsOptional()
  idCustomer?: string;

  @ApiProperty({ description: 'Employee ID filter' })
  @IsString()
  @IsOptional()
  idEmployee?: string;

  @ApiProperty({ description: 'Service ID filter' })
  @IsString()
  @IsOptional()
  serviceName?: string;

  @ApiProperty({ description: 'Order ID filter' })
  @IsString()
  @IsOptional()
  orderNumber?: string;

  @ApiProperty({
    description: 'Status filter',
    enum: AppointmentStatus,
  })
  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Start date filter (ISO 8601 format)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ description: 'End date filter (ISO 8601 format)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class UpdateAppointmentStatusDto {
  @ApiProperty({
    description: 'New appointment status',
    enum: AppointmentStatus,
  })
  @IsEnum(AppointmentStatus)
  @IsNotEmpty()
  status: AppointmentStatus;

  @ApiProperty({ description: 'Modified by user ID' })
  @IsString()
  @IsOptional()
  modifiedBy?: string;
}

export class CustomerAppointmentFiltersDto {
  @ApiProperty({
    description: 'Status filter',
    enum: AppointmentStatus,
  })
  @IsEnum(AppointmentStatus)
  @IsOptional()
  status?: AppointmentStatus;

  @ApiProperty({ description: 'Start date filter (ISO 8601 format)' })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ description: 'End date filter (ISO 8601 format)' })
  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class CustomerAppointmentResponseDto {
  id: string;
  startDate: Date;
  endDate: Date;
  idService: string;
  idCustomer?: string;
  idEmployee?: string;
  idOrder?: string;
  idOrderList?: string[];
  status: AppointmentStatus;
  idBusiness?: string;
  createdBy?: string;
  modifiedBy?: string;
  createdAt?: Date;
  updatedAt?: Date;
  businessName?: string;
  productName?: string;
}

export class DateRangeReportDto {
  @ApiProperty({
    description: 'Start date for the report (ISO 8601 format)',
    example: '2024-01-01',
  })
  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @ApiProperty({
    description: 'End date for the report (ISO 8601 format)',
    example: '2024-01-31',
  })
  @IsDateString()
  @IsNotEmpty()
  endDate: string;
}
