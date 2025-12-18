import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class GetTimeslotsQueryDto {
  @ApiProperty({ description: 'Service ID (required)' })
  @IsString()
  @IsNotEmpty()
  serviceId: string;

  @ApiProperty({
    description: 'Start date (ISO string, optional, default: now)',
    required: false,
  })
  @IsDateString()
  startDate: string;

  @ApiProperty({
    description: 'Number of days (optional, default: 12)',
    required: false,
    minimum: 1,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  days: number;

  @ApiProperty({
    description: 'Minimum hour (format: HH:mm, optional, default: 08:00)',
    required: false,
  })
  @IsString()
  minHour: string;

  @ApiProperty({
    description: 'Maximum hour (format: HH:mm, optional, default: 18:00)',
    required: false,
  })
  @IsString()
  maxHour: string;

  @ApiProperty({
    description:
      'Client timezone offset in minutes (optional, e.g., -300 for UTC-5)',
    required: false,
  })
  @Type(() => Number)
  @IsNumber()
  timezoneOffset: number;
}

export class TimeslotResponseDto {
  @ApiProperty({ description: 'Employee ID' })
  @IsString()
  idEmployee: string;

  @ApiProperty({ description: 'Available slots' })
  @IsArray()
  availableSlots: BaseSlotDto[];
}

export class BaseSlotDto {
  @ApiProperty({ description: 'Start time' })
  @IsDateString()
  start: Date; // Moment object for start time
  @ApiProperty({ description: 'End time' })
  @IsDateString()
  end: Date; // Moment object for end time
}

export class BusinessConfigDto {
  @ApiProperty({ description: 'Minimum hour' })
  @IsString()
  minHour: string; // Format: 'HH:mm'
  @ApiProperty({ description: 'Maximum hour' })
  @IsString()
  maxHour: string; // Format: 'HH:mm'
  @ApiProperty({ description: 'Split time' })
  @IsNumber()
  splitTime: number; // Minutes
}
