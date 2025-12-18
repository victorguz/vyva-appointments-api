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

export class OccupationByEmployeeDto {
  @ApiProperty({ description: 'Employee ID' })
  idEmployee: string;
  @ApiProperty({ description: 'Times' })
  times: number;
}

export class AvailableTimeSlot {
  @ApiProperty({ description: 'Employees IDs' })
  idEmployees: string[];
  @ApiProperty({ description: 'Start time' })
  startTime: Date;
  @ApiProperty({ description: 'End time' })
  endTime: Date;
}

export class TimeslotResponseDto {
  @ApiProperty({ description: 'Least occupied employee for this day' })
  occupationByEmployee: OccupationByEmployeeDto;
  @ApiProperty({ description: 'Available timeslots' })
  availableTimeslots: AvailableTimeSlot[];
}
