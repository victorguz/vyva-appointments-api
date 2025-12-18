import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment } from '../../schemas/appointment.schema';
import { User } from '../../schemas/user.schema';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthGuard } from '../auth/guards/auth.guard';
import { AppointmentsService } from './appointments.service';
import {
  CreateAppointmentDto,
  ListAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';
import { BusinessIdGuard } from '../auth/guards/businessId.guard';

@ApiTags('Appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  @Get('public/:businessId')
  @ApiOperation({ summary: 'Get all appointments for a business (public)' })
  @ApiResponse({
    status: 200,
    description: 'Return all appointments for the business.',
    type: GenericResponse<[Appointment]>,
  })
  async findAllPublic(
    @Param('businessId') businessId: string,
    @Query() filters: ListAppointmentDto,
  ): Promise<GenericResponse<Appointment[]>> {
    return this.appointmentsService.findAllPublic(businessId, filters);
  }

  @Post('public')
  @ApiOperation({ summary: 'Create a new appointment (public)' })
  @ApiResponse({
    status: 201,
    description: 'The appointment has been successfully created.',
    type: GenericResponse<Appointment>,
  })
  async createPublic(
    @Body() createAppointmentDto: CreateAppointmentDto,
  ): Promise<GenericResponse<Appointment>> {
    return this.appointmentsService.createPublic(createAppointmentDto);
  }

  @Post()
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Create a new appointment' })
  @ApiResponse({
    status: 201,
    description: 'The appointment has been successfully created.',
    type: GenericResponse<Appointment>,
  })
  async create(
    @Body() createAppointmentDto: CreateAppointmentDto,
    @CurrentUser() user: User,
  ): Promise<GenericResponse<Appointment>> {
    return this.appointmentsService.create(createAppointmentDto, user);
  }

  @Get()
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Get all appointments with optional filters' })
  @ApiResponse({
    status: 200,
    description: 'Return all appointments.',
    type: GenericResponse<[Appointment]>,
  })
  @UseGuards(AuthGuard, BusinessIdGuard)
  async findAll(
    @Query() filters: ListAppointmentDto,
    @CurrentUser() user: User,
  ): Promise<GenericResponse<Appointment[]>> {
    return this.appointmentsService.findAll(user, filters);
  }

  @Put(':id')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Update an appointment' })
  @ApiResponse({
    status: 200,
    description: 'The appointment has been successfully updated.',
    type: GenericResponse<Appointment>,
  })
  async update(
    @Param('id') id: string,
    @Body() updateAppointmentDto: UpdateAppointmentDto,
    @CurrentUser() user?: User,
  ): Promise<GenericResponse<Appointment>> {
    if (user) {
      updateAppointmentDto.modifiedBy = user.id;
    }
    return this.appointmentsService.update(id, updateAppointmentDto, user);
  }

  @Patch(':id')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Update appointment status' })
  @ApiResponse({
    status: 200,
    description: 'The appointment status has been successfully updated.',
    type: GenericResponse<Appointment>,
  })
  async updateStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateAppointmentStatusDto,
    @CurrentUser() user?: User,
  ): Promise<GenericResponse<Appointment>> {
    if (user) {
      updateStatusDto.modifiedBy = user.id;
    }
    return this.appointmentsService.updateStatus(id, updateStatusDto);
  }

  @Delete(':id')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Delete an appointment' })
  @ApiResponse({
    status: 200,
    description: 'The appointment has been successfully deleted.',
    type: GenericResponse<boolean>,
  })
  async remove(@Param('id') id: string): Promise<GenericResponse<boolean>> {
    return this.appointmentsService.remove(id);
  }
}
