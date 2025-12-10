import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';
import { PaymentMethodType } from '../../../core/constants/domain.constants';

export class SalesOrderPaymentMethodDto {
  @ApiProperty({ description: 'Payment method type', enum: PaymentMethodType })
  @IsEnum(PaymentMethodType)
  @IsNotEmpty()
  type: PaymentMethodType;

  @ApiProperty({ description: 'Payment amount' })
  @IsNumber()
  @IsNotEmpty()
  value: number;

  @ApiProperty({ description: 'Payment reference/transaction ID', required: false })
  @IsString()
  @IsOptional()
  reference?: string;

  @ApiProperty({ description: 'Payment date', required: false })
  @IsString()
  @IsOptional()
  date?: string;
}

