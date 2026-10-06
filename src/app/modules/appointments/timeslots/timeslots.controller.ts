import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { CurrentUser } from '../../../core/auth/decorators/current-user.decorator';
import { AuthGuard } from '../../../core/auth/guards/auth.guard';
import { BusinessIdGuard } from '../../../core/auth/guards/businessId.guard';
import { GenericResponse } from '../../../core/interfaces/generic-response.interface';
import { User } from '../../../schemas/user.schema';
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

  /**
   * Las horas libres para el equipo, desde la app: incluye a los empleados que no
   * salen en los calendarios públicos (p. ej. una lista de espera). Va con sesión,
   * y solo de su propio negocio.
   */
  @Get('team/:businessId')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Get available timeslots for the team, including employees hidden from public calendars',
  })
  @ApiResponse({
    status: 200,
    description: 'Return available timeslots grouped by date.',
    type: GenericResponse,
  })
  async getAvailableTimeslotsForTeam(
    @Param('businessId') businessId: string,
    @Query() query: GetTimeslotsQueryDto,
    @CurrentUser() user: User,
  ): Promise<GenericResponse<{ [date: string]: AvailableTimeSlot[] }>> {
    if (user.idBusiness !== businessId) {
      throw new ForbiddenException();
    }
    return this.timeslotsService.getAvailableTimeslots(businessId, query, true);
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
