import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsEnum, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

import { AppointmentStatus } from '../../../core/constants/domain.constants';
import { SalesOrderPaymentMethodDto } from './payment-method.dto';

export class CreateAppointmentDto {
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
    description: 'Payment methods for the order (handled in frontend after appointment creation)',
    type: [SalesOrderPaymentMethodDto],
    required: false,
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderPaymentMethodDto)
  @IsOptional()
  paymentMethods?: SalesOrderPaymentMethodDto[];

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
  businessInfoId?: string;
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

  @ApiProperty({ description: 'Service ID' })
  @IsString()
  @IsOptional()
  idService?: string;

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
    description: 'Updated payment methods for the order',
    type: [SalesOrderPaymentMethodDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderPaymentMethodDto)
  @IsOptional()
  paymentMethods?: SalesOrderPaymentMethodDto[];

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
}

export class ListAppointmentDto {
  @ApiProperty({ description: 'Order ID filter' })
  @IsString()
  @IsOptional()
  idOrder?: string;

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
