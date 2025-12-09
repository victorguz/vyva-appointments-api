import { AppointmentStatus } from '../core/constants/domain.constants';

export interface Appointment {
  id: number;
  startDate: Date;
  endDate: Date;
  idService: string;
  idCustomer: string;
  idEmployee: string;
  idOrder: string;
  status: AppointmentStatus;
}
