import { Test, TestingModule } from '@nestjs/testing';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentsCustomerService } from './appointments-customer.service';
import { AppointmentsPublicService } from './appointments-public.service';
import { TimeOutAppointmentsService } from './timeout-appointments.service';
import { AuthGuard } from '../../core/auth/guards/auth.guard';
import { BusinessIdGuard } from '../../core/auth/guards/businessId.guard';

describe('AppointmentsController', () => {
  let controller: AppointmentsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppointmentsController],
      providers: [
        { provide: AppointmentsService, useValue: {} },
        { provide: AppointmentsCustomerService, useValue: {} },
        { provide: AppointmentsPublicService, useValue: {} },
        { provide: TimeOutAppointmentsService, useValue: {} },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(BusinessIdGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AppointmentsController>(AppointmentsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
