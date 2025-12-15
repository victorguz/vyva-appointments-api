import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { GenericResponse } from '../../../core/interfaces/generic-response.interface';
import { TimeslotsService } from './timeslots.service';
import { GetTimeslotsQueryDto, TimeslotResponseDto } from './dto/timeslots.dto';

@ApiTags('Timeslots')
@Controller('appointments/timeslots')
export class TimeslotsController {
  constructor(private readonly timeslotsService: TimeslotsService) {}

  @Get('public/:businessId')
  @ApiOperation({ summary: 'Get available timeslots for a business (public)' })
  @ApiResponse({
    status: 200,
    description: 'Return available timeslots for the next 12 days.',
    type: GenericResponse<[TimeslotResponseDto]>,
  })
  async getAvailableTimeslotsPublic(
    @Param('businessId') businessId: string,
    @Query() query: GetTimeslotsQueryDto,
  ): Promise<GenericResponse<TimeslotResponseDto[]>> {
    const startDate = query.startDate ? new Date(query.startDate) : undefined;
    const days = query.days || 12;

    return this.timeslotsService.getAvailableTimeslots(businessId, query.serviceId, {
      startDate,
      days,
    });
  }
}

