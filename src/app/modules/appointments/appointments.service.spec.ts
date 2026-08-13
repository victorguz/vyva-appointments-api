import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';

import { AppointmentsService } from './appointments.service';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { RealtimePublisherService } from '../shared/realtime-publisher.service';
import { WebhookDispatchService } from '../shared/webhook-dispatch.service';

describe('AppointmentsService', () => {
  let service: AppointmentsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppointmentsService,
        { provide: LambdaInvokeService, useValue: {} },
        { provide: RealtimePublisherService, useValue: {} },
        { provide: WebhookDispatchService, useValue: {} },
        {
          provide: getModelToken('Appointment'),
          useValue: {},
        },
        {
          provide: getModelToken('Customer'),
          useValue: {},
        },
        {
          provide: getModelToken('User'),
          useValue: {},
        },
        {
          provide: getModelToken('Product'),
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<AppointmentsService>(AppointmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
