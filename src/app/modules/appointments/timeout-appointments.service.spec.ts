import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from 'nestjs-dynamoose';

import { TimeOutAppointmentsService } from './timeout-appointments.service';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import { RealtimePublisherService } from '../shared/realtime-publisher.service';
import { CreateTimeOutAppointmentDto } from './dto/appointments.dto';

describe('TimeOutAppointmentsService', () => {
  let service: TimeOutAppointmentsService;
  let model: { create: jest.Mock; get: jest.Mock; delete: jest.Mock; update: jest.Mock };
  let lambdaInvokeService: { invokeFunction: jest.Mock };
  let realtimePublisher: { publishAppointmentChange: jest.Mock };

  const user = { id: 'user-1', idBusiness: 'business-1' } as any;
  const baseDto: CreateTimeOutAppointmentDto = {
    startDate: '2026-01-01T10:00:00.000Z',
    endDate: '2026-01-01T11:00:00.000Z',
    employeeIds: ['emp-1', 'emp-2'],
    customerName: 'Cierre general',
  };

  beforeEach(async () => {
    const stored = new Map<string, any>();

    model = {
      create: jest.fn(async (payload: any) => {
        stored.set(payload.id, { ...payload });
        return payload;
      }),
      get: jest.fn(async ({ id }: { id: string }) => {
        const found = stored.get(id);
        return found ? { toJSON: () => found } : undefined;
      }),
      update: jest.fn(async ({ id }: { id: string }, changes: any) => {
        stored.set(id, { ...stored.get(id), ...changes });
      }),
      delete: jest.fn(async ({ id }: { id: string }) => {
        stored.delete(id);
      }),
    };

    lambdaInvokeService = {
      invokeFunction: jest.fn().mockResolvedValue({ data: { eventId: 'evt-1' } }),
    };
    realtimePublisher = {
      publishAppointmentChange: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TimeOutAppointmentsService,
        { provide: LambdaInvokeService, useValue: lambdaInvokeService },
        { provide: RealtimePublisherService, useValue: realtimePublisher },
        { provide: getModelToken('Appointment'), useValue: model },
      ],
    }).compile();

    service = module.get<TimeOutAppointmentsService>(TimeOutAppointmentsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('creates one appointment per employee and returns them all', async () => {
    const response = await service.createBatch(baseDto, user);

    expect(response.data).toHaveLength(2);
    expect(model.create).toHaveBeenCalledTimes(2);
    const idEmployees = response.data!.map((a: any) => a.idEmployee);
    expect(idEmployees).toEqual(['emp-1', 'emp-2']);
    expect(response.data!.every((a: any) => a.idBusiness === 'business-1')).toBe(true);
    expect(response.data!.every((a: any) => a.status === 'timeOut')).toBe(true);
    expect(realtimePublisher.publishAppointmentChange).toHaveBeenCalledTimes(2);
    expect(lambdaInvokeService.invokeFunction).toHaveBeenCalledTimes(2);
  });

  it('rejects when employeeIds is empty', async () => {
    await expect(
      service.createBatch({ ...baseDto, employeeIds: [] }, user),
    ).rejects.toThrow();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rejects when endDate is before or equal to startDate', async () => {
    await expect(
      service.createBatch(
        { ...baseDto, startDate: baseDto.endDate, endDate: baseDto.startDate },
        user,
      ),
    ).rejects.toThrow();
    expect(model.create).not.toHaveBeenCalled();
  });

  it('rolls back appointments already created in the batch if a later one fails', async () => {
    const stored = new Map<string, any>();
    let callCount = 0;
    model.create.mockImplementation(async (payload: any) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('DB failure');
      }
      stored.set(payload.id, { ...payload });
      return payload;
    });
    model.get.mockImplementation(async ({ id }: { id: string }) => {
      const found = stored.get(id);
      return found ? { toJSON: () => found } : undefined;
    });

    await expect(
      service.createBatch({ ...baseDto, employeeIds: ['emp-1', 'emp-2'] }, user),
    ).rejects.toThrow('DB failure');

    expect(model.delete).toHaveBeenCalledTimes(1);
  });
});
