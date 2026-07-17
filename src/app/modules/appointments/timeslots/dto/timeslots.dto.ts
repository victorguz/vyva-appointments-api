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
    description: 'Comma-separated service IDs used to calculate slot duration',
    required: false,
  })
  @IsOptional()
  @IsString()
  serviceIds?: string;

  @ApiProperty({
    description: 'Employee ID used to filter available slots',
    required: false,
  })
  @IsOptional()
  @IsString()
  employeeId?: string;

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
    description:
      'Client timezone offset in minutes (optional, e.g., -300 for UTC-5)',
    required: false,
  })
  @Type(() => Number)
  @IsNumber()
  timezoneOffset: number;

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

export class AvailableTimeSlot {
  @ApiProperty({ description: 'Least occupied employee available for this slot' })
  idEmployee: string;
  @ApiProperty({ description: 'Start time' })
  startTime: Date;
  @ApiProperty({ description: 'End time' })
  endTime: Date;
}

