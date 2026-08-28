import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { GenericResponse } from '../../../core/interfaces/generic-response.interface';
import { TimeslotsService } from './timeslots.service';
import { AvailableTimeSlot, GetTimeslotsQueryDto } from './dto/timeslots.dto';

@ApiTags('Timeslots')
@Controller('appointments/timeslots')
export class TimeslotsController {
  constructor(private readonly timeslotsService: TimeslotsService) {}

  @Get('public/:businessId')
  @ApiOperation({ summary: 'Get available timeslots for a business (public)' })
  @ApiResponse({
    status: 200,
    description: 'Return available timeslots grouped by date.',
    type: GenericResponse,
  })
  async getAvailableTimeslotsPublic(
    @Param('businessId') businessId: string,
    @Query() query: GetTimeslotsQueryDto,
  ): Promise<GenericResponse<{ [date: string]: AvailableTimeSlot[] }>> {
    return this.timeslotsService.getAvailableTimeslots(businessId, query);
  }
}

/**
 * Misma consulta bajo el prefijo público de la API.
 *
 * API Gateway solo deja sin autorizador las rutas `/api/appointments/public/**`
 * (ver serverless.yml). La ruta antigua, con `public` en medio, caía en el
 * proxy autenticado y devolvía 401 a cualquier visitante sin sesión.
 */
@ApiTags('Timeslots')
@Controller('appointments/public/timeslots')
export class PublicTimeslotsController {
  constructor(private readonly timeslotsService: TimeslotsService) {}

  @Get(':businessId')
  @ApiOperation({ summary: 'Get available timeslots for a business (public)' })
  @ApiResponse({
    status: 200,
    description: 'Return available timeslots grouped by date.',
    type: GenericResponse,
  })
  async getAvailableTimeslots(
    @Param('businessId') businessId: string,
    @Query() query: GetTimeslotsQueryDto,
  ): Promise<GenericResponse<{ [date: string]: AvailableTimeSlot[] }>> {
    return this.timeslotsService.getAvailableTimeslots(businessId, query);
  }
}
