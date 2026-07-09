import { Injectable, Logger } from '@nestjs/common';
import { InjectModel, Model } from 'nestjs-dynamoose';

import { Appointment, AppointmentKey } from '../../schemas/appointment.schema';
import { AppointmentStatus } from '../../core/constants/domain.constants';
import { Customer, CustomerKey } from '../../schemas/customer.schema';
import { Domain, DomainKey } from '../../schemas/domain.schema';
import { Reminder, ReminderKey } from '../../schemas/reminder.schema';
import { User, UserKey } from '../../schemas/user.schema';
import { LambdaInvokeService } from '../shared/lambda-invoke.service';
import {
  APPOINTMENT_BOOKING_TEMPLATE,
  AppointmentReminderNotificationSettings,
  AppointmentReminderStatusKey,
  buildAppointmentReminderId,
  buildBookingReminderId,
  PRE_COMPLETION_REMINDER_STATUS_KEYS,
  resolveAppointmentReminderTemplate,
  resolveAppointmentTemplateMetaKey,
  resolveStatusReminderSendDate,
  REMINDER_TYPE_APPOINTMENT,
  shouldScheduleAppointmentReminder,
  shouldSendScheduledAppointmentReminder,
  toReminderExpiresAtSeconds,
} from './appointment-reminder.util';

const WHATSAPP_NOTIFICATION_SETTINGS_GROUP = 'whatsappNotificationSettings';

/** Send completed immediately only when already due (avoid waiting for the cron). */
const COMPLETED_IMMEDIATE_GRACE_MS = 5_000;

interface WhatsAppNotificationSettings extends AppointmentReminderNotificationSettings {
  recipientPhones?: string[];
  sendOnlyToRecipientPhones?: boolean;
  useOwnWhatsAppAccount?: boolean;
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly lambdaInvokeService: LambdaInvokeService,
    @InjectModel('Reminder')
    private readonly reminderModel: Model<Reminder, ReminderKey>,
    @InjectModel('Appointment')
    private readonly appointmentModel: Model<Appointment, AppointmentKey>,
    @InjectModel('Customer')
    private readonly customerModel: Model<Customer, CustomerKey>,
    @InjectModel('Domain')
    private readonly domainModel: Model<Domain, DomainKey>,
    @InjectModel('User')
    private readonly userModel: Model<User, UserKey>,
  ) {}

  async sendBookingNotification(appointment: Appointment): Promise<void> {
    try {
      if (!appointment.idBusiness) {
        this.logger.log(
          `Booking notification skipped for ${appointment.id}: missing business`,
        );
        return;
      }

      const notificationSettings = await this.loadNotificationSettings(
        appointment.idBusiness,
      );
      if (!notificationSettings?.appointmentReminders?.enabled) {
        this.logger.log(
          `Booking notification skipped for ${appointment.id}: appointmentReminders disabled`,
        );
        return;
      }

      const recipients = await this.resolveRecipientsForAppointment(
        appointment,
        notificationSettings,
      );
      if (!recipients.length) {
        this.logger.log(
          `Booking notification skipped for ${appointment.id}: no valid recipients`,
        );
        return;
      }

      for (const recipient of recipients) {
        const reminder: Reminder = {
          id: buildBookingReminderId(appointment.id, recipient),
          type: REMINDER_TYPE_APPOINTMENT,
          idReference: appointment.id,
          template: APPOINTMENT_BOOKING_TEMPLATE,
          recipient,
          channel: 'whatsapp',
          sendDate: new Date(),
          expiresAt: 0,
          idBusiness: appointment.idBusiness,
        };

        await this.sendReminder(reminder, { skipEligibilityCheck: true });
      }
    } catch (error) {
      this.logger.warn(
        `sendBookingNotification failed for ${appointment.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  async ensureAppointment(
    appointment: Appointment,
    options?: { deleted?: boolean },
  ): Promise<void> {
    try {
      if (options?.deleted) {
        await this.deleteAppointmentReminders(appointment.id);
        return;
      }

      if (!shouldScheduleAppointmentReminder(appointment)) {
        await this.deleteAppointmentReminders(appointment.id);
        return;
      }

      const notificationSettings = await this.loadNotificationSettings(
        appointment.idBusiness!,
      );
      if (!notificationSettings?.appointmentReminders?.enabled) {
        await this.deleteAppointmentReminders(appointment.id);
        return;
      }

      const recipients = await this.resolveRecipientsForAppointment(
        appointment,
        notificationSettings,
      );
      if (!recipients.length) {
        await this.deleteAppointmentReminders(appointment.id);
        return;
      }

      if (appointment.status === AppointmentStatus.completed) {
        await this.deleteRemindersForStatusKeys(
          appointment.id,
          PRE_COMPLETION_REMINDER_STATUS_KEYS,
        );
        await this.ensureStatusReminders(
          appointment,
          recipients,
          notificationSettings,
          [AppointmentStatus.completed],
        );
        return;
      }

      await this.deleteRemindersForStatusKeys(appointment.id, [
        AppointmentStatus.completed,
      ]);
      await this.ensureStatusReminders(
        appointment,
        recipients,
        notificationSettings,
        PRE_COMPLETION_REMINDER_STATUS_KEYS,
      );
    } catch (error) {
      this.logger.warn(
        `ensureAppointment failed for ${appointment.id}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`,
      );
    }
  }

  /**
   * Ensures the reminders that still need to be sent for the given appointment
   * exist and are up to date. Sent reminders are deleted by the dispatcher, so a
   * missing reminder means it was already sent. This method refreshes reminders
   * that are still pending (e.g. when the appointment date/time changed) and
   * removes pending reminders that are no longer applicable, while leaving
   * reminders that were already queued for dispatch untouched to avoid duplicate
   * sends.
   */
  private async ensureStatusReminders(
    appointment: Appointment,
    recipients: string[],
    settings: WhatsAppNotificationSettings,
    statusKeys: AppointmentReminderStatusKey[],
  ): Promise<void> {
    for (const statusKey of statusKeys) {
      const template = resolveAppointmentReminderTemplate(statusKey);
      if (!template) {
        continue;
      }

      const sendDate = resolveStatusReminderSendDate(
        appointment,
        statusKey,
        settings,
      );

      const validReminderIds = new Set<string>();

      if (sendDate) {
        // Completed already due (hours≈0): send now like booking; do not wait for cron.
        const delayMs = sendDate.getTime() - Date.now();
        const sendCompletedNow =
          statusKey === AppointmentStatus.completed &&
          delayMs <= COMPLETED_IMMEDIATE_GRACE_MS;

        if (sendCompletedNow) {
          for (const recipient of recipients) {
            const reminderId = buildAppointmentReminderId(
              appointment.id,
              recipient,
              statusKey,
            );
            validReminderIds.add(reminderId);

            const existing = await this.reminderModel.get({ id: reminderId });
            if (existing) {
              const existingStatus = existing.toJSON()?.status;
              if (existingStatus === 'queued') {
                continue;
              }
              try {
                await this.reminderModel.delete({ id: reminderId });
              } catch {
                // ignore
              }
            }

            const reminder: Reminder = {
              id: reminderId,
              type: REMINDER_TYPE_APPOINTMENT,
              idReference: appointment.id,
              template,
              recipient,
              channel: 'whatsapp',
              sendDate: new Date(),
              expiresAt: toReminderExpiresAtSeconds(new Date()),
              idBusiness: appointment.idBusiness,
            };

            try {
              await this.sendReminder(reminder);
            } catch (error) {
              this.logger.warn(
                `Immediate completed reminder failed ${reminderId}: ${
                  error instanceof Error ? error.message : 'unknown error'
                }`,
              );
            }
          }

          await this.deleteStalePendingReminders(
            appointment.id,
            statusKey,
            validReminderIds,
          );
          continue;
        }

        for (const recipient of recipients) {
          const reminderId = buildAppointmentReminderId(
            appointment.id,
            recipient,
            statusKey,
          );
          validReminderIds.add(reminderId);

          const existing = await this.reminderModel.get({ id: reminderId });
          const existingStatus = existing?.toJSON()?.status;

          if (existing) {
            // Already queued for dispatch: leave it as is.
            if (existingStatus === 'queued') {
              continue;
            }

            // Still pending: refresh with the latest appointment data.
            await this.reminderModel.update(
              { id: reminderId },
              {
                template,
                recipient,
                channel: 'whatsapp',
                sendDate,
                expiresAt: toReminderExpiresAtSeconds(sendDate),
                status: 'pending',
                idBusiness: appointment.idBusiness,
              },
            );
            continue;
          }

          const payload: Reminder = {
            id: reminderId,
            type: REMINDER_TYPE_APPOINTMENT,
            idReference: appointment.id,
            template,
            recipient,
            channel: 'whatsapp',
            sendDate,
            expiresAt: toReminderExpiresAtSeconds(sendDate),
            status: 'pending',
            idBusiness: appointment.idBusiness,
          };

          await this.reminderModel.create(payload);
        }
      }

      // Remove pending reminders for this status key that are no longer needed
      // (e.g. no valid send date, or the recipient list changed).
      await this.deleteStalePendingReminders(
        appointment.id,
        statusKey,
        validReminderIds,
      );
    }
  }

  private async deleteStalePendingReminders(
    idAppointment: string,
    statusKey: AppointmentReminderStatusKey,
    validReminderIds: Set<string>,
  ): Promise<void> {
    const reminders = await this.reminderModel
      .query('type')
      .eq(REMINDER_TYPE_APPOINTMENT)
      .where('idReference')
      .eq(idAppointment)
      .using('type-idReference-index')
      .exec();

    const suffix = `:${statusKey}`;

    for (const row of reminders ?? []) {
      const reminder = row.toJSON() as Reminder;
      if (!reminder.id.endsWith(suffix)) {
        continue;
      }
      if (validReminderIds.has(reminder.id)) {
        continue;
      }
      // Only delete reminders that have not been queued for dispatch yet.
      if (reminder.status === 'queued') {
        continue;
      }

      try {
        await this.reminderModel.delete({ id: reminder.id });
      } catch (error) {
        this.logger.debug(
          `Failed to delete stale reminder ${reminder.id} for appointment ${idAppointment}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  async sendReminder(
    reminder: Reminder,
    options?: { skipEligibilityCheck?: boolean },
  ): Promise<void> {
    if (reminder.type !== REMINDER_TYPE_APPOINTMENT) {
      this.logger.warn(`Unsupported reminder type: ${reminder.type}`);
      return;
    }

    if (reminder.channel !== 'whatsapp') {
      this.logger.warn(
        `Reminder channel not implemented yet: ${reminder.channel}`,
      );
      return;
    }

    const appointment = await this.appointmentModel.get({
      id: reminder.idReference,
    });
    if (!appointment) {
      this.logger.warn(
        `Appointment ${reminder.idReference} not found for reminder ${reminder.id}`,
      );
      return;
    }

    const appointmentData = appointment.toJSON() as Appointment;

    const appointmentBusinessId =
      reminder.idBusiness ?? appointmentData.idBusiness;
    if (!appointmentBusinessId) {
      this.logger.warn(`Reminder ${reminder.id} missing idBusiness`);
      return;
    }

    const notificationSettings = await this.loadNotificationSettings(
      appointmentBusinessId,
    );

    if (
      !options?.skipEligibilityCheck &&
      !shouldSendScheduledAppointmentReminder(
        appointmentData,
        reminder.template,
        {
          allowWithoutCustomer:
            notificationSettings?.sendOnlyToRecipientPhones === true,
        },
      )
    ) {
      this.logger.log(
        `Skipping reminder ${reminder.id}; appointment no longer eligible`,
      );
      return;
    }

    const appointmentTemplateKey = resolveAppointmentTemplateMetaKey(
      reminder.template,
    );
    if (!appointmentTemplateKey) {
      this.logger.warn(
        `Unknown template for reminder ${reminder.id}: ${reminder.template}`,
      );
      return;
    }

    const actor = await this.resolveBusinessActor(appointmentBusinessId);
    if (!actor) {
      this.logger.warn(
        `No business user found to send reminder ${reminder.id} for ${appointmentBusinessId}`,
      );
      return;
    }

    const sendOnlyToRegistered =
      notificationSettings?.sendOnlyToRecipientPhones === true;

    const response = await this.lambdaInvokeService.invokeFunction(
      'vyva-whatsapp',
      'POST',
      '/api/whatsapp/messages/template',
      {
        waPhone: reminder.recipient,
        appointmentBusinessId,
        appointmentTemplateKey,
        appointmentContext: {
          customerName: appointmentData.customerName,
          serviceName: appointmentData.serviceName,
          employeeName: appointmentData.employeeName,
          startDate: appointmentData.startDate,
          endDate: appointmentData.endDate,
        },
        clientMessageId: reminder.id,
        idCustomer: sendOnlyToRegistered
          ? undefined
          : appointmentData.idCustomer,
        displayName: appointmentData.customerName,
      },
      actor,
    );

    if (response?.success === false) {
      if (response?.handledError === true) {
        this.logger.warn(
          `WhatsApp reminder ${reminder.id} not sent: ${response?.message ?? 'handled error'}`,
        );
        return;
      }
      throw new Error(response?.message || 'WhatsApp template send failed');
    }
  }

  private async deleteRemindersForStatusKeys(
    idAppointment: string,
    statusKeys: AppointmentReminderStatusKey[],
  ): Promise<void> {
    const reminders = await this.reminderModel
      .query('type')
      .eq(REMINDER_TYPE_APPOINTMENT)
      .where('idReference')
      .eq(idAppointment)
      .using('type-idReference-index')
      .exec();

    const statusSuffixes = statusKeys.map((statusKey) => `:${statusKey}`);

    for (const row of reminders ?? []) {
      const reminder = row.toJSON() as Reminder;
      if (!statusSuffixes.some((suffix) => reminder.id.endsWith(suffix))) {
        continue;
      }

      try {
        await this.reminderModel.delete({ id: reminder.id });
      } catch (error) {
        this.logger.debug(
          `Failed to delete reminder ${reminder.id} for appointment ${idAppointment}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  private async deleteAppointmentReminders(idAppointment: string): Promise<void> {
    const reminders = await this.reminderModel
      .query('type')
      .eq(REMINDER_TYPE_APPOINTMENT)
      .where('idReference')
      .eq(idAppointment)
      .using('type-idReference-index')
      .exec();

    for (const row of reminders ?? []) {
      const reminder = row.toJSON() as Reminder;
      try {
        await this.reminderModel.delete({ id: reminder.id });
      } catch (error) {
        this.logger.debug(
          `Failed to delete reminder ${reminder.id} for appointment ${idAppointment}: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    }
  }

  private async loadNotificationSettings(
    idBusiness: string,
  ): Promise<WhatsAppNotificationSettings | null> {
    const domains = await this.domainModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('domain-idBusiness-index')
      .where('group')
      .eq(WHATSAPP_NOTIFICATION_SETTINGS_GROUP)
      .exec();

    if (!domains?.length) {
      return null;
    }

    const record = domains[0].toJSON() as Domain;
    try {
      return JSON.parse(record.value ?? '{}') as WhatsAppNotificationSettings;
    } catch {
      return null;
    }
  }

  private async resolveRecipientsForAppointment(
    appointment: Appointment,
    settings: WhatsAppNotificationSettings | null,
  ): Promise<string[]> {
    let customerPhone: string | undefined;

    if (appointment.idCustomer) {
      const customer = await this.customerModel.get({
        id: appointment.idCustomer,
      });
      customerPhone = customer?.toJSON()?.phone;
    }

    return this.resolveReminderRecipients(settings, customerPhone);
  }

  private resolveReminderRecipients(
    settings: WhatsAppNotificationSettings | null,
    customerPhone?: string,
  ): string[] {
    if (settings?.sendOnlyToRecipientPhones === true) {
      const phones = (settings.recipientPhones ?? [])
        .map((entry) => this.normalizeWhatsAppPhone(entry))
        .filter(Boolean);
      return [...new Set(phones)];
    }

    const normalizedCustomer = this.normalizeWhatsAppPhone(customerPhone);
    return normalizedCustomer ? [normalizedCustomer] : [];
  }

  private async resolveBusinessActor(idBusiness: string): Promise<User | null> {
    const users = await this.userModel
      .query('idBusiness')
      .eq(idBusiness)
      .using('businessInfo-index')
      .limit(1)
      .exec();

    if (!users?.length) {
      return null;
    }

    return users[0].toJSON() as User;
  }

  private normalizeWhatsAppPhone(value?: string): string {
    const digits = (value ?? '').replace(/\D/g, '');
    if (!digits) {
      return '';
    }
    if (digits.length === 10 && digits.startsWith('3')) {
      return `57${digits}`;
    }
    return digits;
  }
}
