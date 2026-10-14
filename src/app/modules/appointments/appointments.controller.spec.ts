import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, TestingModule } from '@nestjs/testing';

import { AppointmentsController } from './appointments.controller';
import { AppointmentsService } from './appointments.service';
import { AppointmentsCustomerService } from './appointments-customer.service';
import { TimeOutAppointmentsService } from './timeout-appointments.service';
import { ExternalImportService } from './external-import.service';
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
        { provide: TimeOutAppointmentsService, useValue: {} },
        { provide: ExternalImportService, useValue: {} },
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

  it('ya no expone POST /appointments/public (alta de citas sin sesión)', () => {
    const proto = AppointmentsController.prototype as unknown as Record<
      string,
      unknown
    >;
    const publicPosts = Object.getOwnPropertyNames(proto).filter((name) => {
      const handler = proto[name];
      if (typeof handler !== 'function') return false;
      const path = Reflect.getMetadata(PATH_METADATA, handler);
      const method = Reflect.getMetadata(METHOD_METADATA, handler);
      return method === RequestMethod.POST && path === 'public';
    });
    expect(publicPosts).toEqual([]);
  });
});
