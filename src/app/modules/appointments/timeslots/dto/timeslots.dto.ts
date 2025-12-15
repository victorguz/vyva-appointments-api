import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class GetTimeslotsQueryDto {
  @ApiProperty({ description: 'Service ID (required)' })
  @IsString()
  @IsNotEmpty()
  serviceId: string;

  @ApiProperty({ description: 'Start date (ISO string, optional, default: now)', required: false })
  @IsDateString()
  @IsOptional()
  startDate?: string;

  @ApiProperty({ description: 'Number of days (optional, default: 12)', required: false, minimum: 1 })
  @IsNumber()
  @IsOptional()
  @Min(1)
  days?: number;
}

export class TimeslotResponseDto {
  @ApiProperty({ description: 'Date in ISO format' })
  date: string;

  @ApiProperty({ description: 'Start datetime in ISO format' })
  start: string;

  @ApiProperty({ description: 'End datetime in ISO format' })
  end: string;

  @ApiProperty({ description: 'Array of available employee IDs', type: [String] })
  availableEmployeeIds: string[];
}

