import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { GenericResponse } from '../../core/interfaces/generic-response.interface';
import { Appointment } from '../../schemas/appointment.schema';
import { User } from '../../schemas/user.schema';
import { CurrentUser } from '../../core/auth/decorators/current-user.decorator';
import { AuthGuard } from '../../core/auth/guards/auth.guard';
import { AppointmentsService } from './appointments.service';
import {
  CreateAppointmentDto,
  CreateTimeOutAppointmentDto,
  ListAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointments.dto';
import { BusinessIdGuard } from '../../core/auth/guards/businessId.guard';
import { AppointmentsCustomerService } from './appointments-customer.service';
import { AppointmentsPublicService } from './appointments-public.service';
import { TimeOutAppointmentsService } from './timeout-appointments.service';

@ApiTags('Appointments')
@Controller('appointments')
export class AppointmentsController {
  constructor(
    private readonly appointmentsService: AppointmentsService,
    private readonly appointmentsCustomerService: AppointmentsCustomerService,
    private readonly appointmentsPublicService: AppointmentsPublicService,
    private readonly timeOutAppointmentsService: TimeOutAppointmentsService,
  ) {}

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
    return this.appointmentsPublicService.createPublic(createAppointmentDto);
  }

  @Post('without-service')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({
    summary:
      'Create a new appointment without service (time off, breaks, etc.)',
  })
  @ApiResponse({
    status: 201,
    description:
      'The appointment without service has been successfully created.',
    type: GenericResponse<Appointment>,
  })
  @ApiResponse({ status: 400, description: 'Bad request.' })
  async createTimeOutAppointment(
    @Body() createTimeOutAppointmentDto: CreateTimeOutAppointmentDto,
    @CurrentUser() user: User,
  ): Promise<GenericResponse<Appointment[]>> {
    return this.timeOutAppointmentsService.createBatch(
      createTimeOutAppointmentDto,
      user,
    );
  }

  @Post()
  @UseGuards(AuthGuard)
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

  @Get('customer-appointments')
  @UseGuards(AuthGuard)
  @ApiOperation({
    summary: 'Get all appointments for the authenticated customer',
  })
  @ApiResponse({
    status: 200,
    description: 'Return all appointments for the customer.',
    type: GenericResponse<[Appointment]>,
  })
  async findCustomerAppointments(
    @CurrentUser() user: User,
  ): Promise<GenericResponse<Appointment[]>> {
    return this.appointmentsCustomerService.findAllByCustomer(user);
  }

  @Get(':id')
  @UseGuards(AuthGuard, BusinessIdGuard)
  @ApiOperation({ summary: 'Get an appointment by ID' })
  @ApiResponse({
    status: 200,
    description: 'Return the appointment.',
    type: GenericResponse<Appointment>,
  })
  async findById(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<GenericResponse<Appointment>> {
    return this.appointmentsService.findById(id, user);
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
    return this.appointmentsService.updateStatus(id, updateStatusDto, user);
  }

  @Delete('customer-appointments/:id/cancel')
  @UseGuards(AuthGuard)
  @ApiOperation({ summary: 'Cancel an appointment (customer only)' })
  @ApiResponse({
    status: 200,
    description: 'The appointment has been successfully canceled.',
    type: GenericResponse<Appointment>,
  })
  async cancelCustomerAppointment(
    @Param('id') id: string,
    @CurrentUser() user: User,
  ): Promise<GenericResponse<Appointment>> {
    return this.appointmentsCustomerService.cancelCustomerAppointment(id, user);
  }
}
