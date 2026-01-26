import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

import {
  PaymentMethodType,
  SalesOrderStatus,
} from '../../../core/constants/domain.constants';
import { SalesOrderItem } from '../../../schemas/sales-order.schema';
import { DashboardSingleCardItem } from 'src/app/interfaces/dashboard.interface';

export class SalesOrderItemDto implements SalesOrderItem {
  @ApiProperty({ description: 'Product ID' })
  @IsString()
  @IsOptional()
  id: string;

  @ApiProperty({ description: 'Product quantity' })
  @IsNumber()
  @IsNotEmpty()
  quantity: number;

  @ApiProperty({ description: 'Product is service' })
  @IsBoolean()
  @IsOptional()
  isService?: boolean;

  @ApiProperty({ description: 'Product price' })
  @IsNumber()
  @IsOptional()
  price?: number;

  @ApiProperty({ description: 'Product offer price' })
  @IsNumber()
  @IsOptional()
  offerPrice?: number;

  @ApiProperty({ description: 'Product type' })
  @IsString()
  @IsOptional()
  type?: string;

  @ApiProperty({ description: 'Product commission' })
  @IsNumber()
  @IsOptional()
  commission?: number;

  @ApiProperty({ description: 'Product name' })
  @IsString()
  @IsOptional()
  name?: string;
}

export class SalesOrderPaymentMethodDto {
  @ApiProperty({ description: 'Payment amount' })
  @IsNumber()
  @IsNotEmpty()
  value: number;

  @ApiProperty({ description: 'Payment method type', enum: PaymentMethodType })
  @IsString()
  @IsNotEmpty()
  type: PaymentMethodType;
}

export class CreateSalesOrderDto {
  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsOptional()
  idCustomer?: string;

  @ApiProperty({ description: 'Products to sell', type: [SalesOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  @IsNotEmpty()
  products: SalesOrderItemDto[];

  @ApiProperty({
    description: 'Payment methods',
    type: [SalesOrderPaymentMethodDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderPaymentMethodDto)
  @IsNotEmpty()
  paymentMethods: SalesOrderPaymentMethodDto[];
}

export class UpdateSalesOrderDto {
  @ApiProperty({ description: 'Products to sell', type: [SalesOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderItemDto)
  @IsNotEmpty()
  products: SalesOrderItemDto[];

  @ApiProperty({
    description: 'Payment methods',
    type: [SalesOrderPaymentMethodDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SalesOrderPaymentMethodDto)
  @IsNotEmpty()
  paymentMethods: SalesOrderPaymentMethodDto[];

  @ApiProperty({ description: 'Order status' })
  @IsIn(Object.values(SalesOrderStatus))
  @IsOptional()
  status: SalesOrderStatus = SalesOrderStatus.pending;

  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsNotEmpty()
  idCustomer: string;
}

export class DeleteSalesOrderDto {
  @ApiProperty({ description: 'Sales order ID' })
  @IsString()
  @IsNotEmpty()
  id: string;
}

export class ListSalesOrderDto {
  @ApiProperty({ description: 'Customer ID' })
  @IsString()
  @IsOptional()
  idCustomer?: string;

  @ApiProperty({ description: 'Business info ID' })
  @IsString()
  @IsOptional()
  idBusiness?: string;

  @ApiProperty({
    description: 'Start date for the report (ISO 8601 format)',
    example: '2024-01-01',
  })
  @IsDateString()
  @IsOptional()
  startDate?: Date;

  @ApiProperty({
    description: 'End date for the report (ISO 8601 format)',
    example: '2024-01-31',
  })
  @IsDateString()
  @IsOptional()
  endDate?: Date;

  @ApiProperty({ description: 'Limit' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  limit?: number;

  @ApiProperty({ description: 'Last key' })
  @IsString()
  @IsOptional()
  lastKey?: string;
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

export class SalesReportResponseDto implements DashboardSingleCardItem {
  @ApiProperty({ description: 'Report title' })
  title: string;

  @ApiProperty({ description: 'Report description' })
  description: string;

  @ApiProperty({ description: 'Current period value' })
  currentValue: number;

  @ApiProperty({ description: 'Previous period value' })
  lastValue: number;

  @ApiProperty({ description: 'Whether the value represents currency' })
  isCurrency: boolean;

  @ApiProperty({ description: 'Report frequency' })
  frequency: string;
}

export class PaymentMethodSummaryDto {
  @ApiProperty({ description: 'Payment method type' })
  paymentMethod: string;

  @ApiProperty({ description: 'Total amount for this payment method' })
  totalAmount: number;

  @ApiProperty({ description: 'Number of transactions' })
  transactionCount: number;

  @ApiProperty({ description: 'Percentage of total sales' })
  percentage: number;
}

export class DailyPaymentMethodsResponseDto {
  @ApiProperty({ description: 'Date of the report' })
  date: string;

  @ApiProperty({ description: 'Total daily sales amount' })
  totalDailySales: number;

  @ApiProperty({
    description: 'Payment methods breakdown',
    type: [PaymentMethodSummaryDto],
  })
  paymentMethods: PaymentMethodSummaryDto[];

  @ApiProperty({ description: 'Total number of orders' })
  totalOrders: number;
}
