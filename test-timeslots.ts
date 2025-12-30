/**
 * Mock test script for timeslots service
 * Run with: npx ts-node test-timeslots.ts
 */

import * as moment from 'moment-timezone';

// Mock data
const mockService = {
  id: 'service-1',
  measure: 30, // 30 minutes duration
  idBusiness: 'business-1',
};

const mockEmployees = [
  { id: 'emp-1', name: 'Employee 1', idBusiness: 'business-1' },
  { id: 'emp-2', name: 'Employee 2', idBusiness: 'business-1' },
];

const mockAppointments: any[] = [
  // Example: appointment from 10:00 to 10:30 on today
];

const config = {
  minHour: '08:00',
  maxHour: '18:00',
  splitTime: 5,
};

// Simulate the generateBaseSlots logic
function generateBaseSlots(
  startDate: moment.Moment,
  days: number,
  slotDuration: number,
  config: { minHour: string; maxHour: string; splitTime: number },
  timezoneOffsetHours: number = 0,
  clientCurrentTime?: moment.Moment,
): any[] {
  const baseSlots: any[] = [];

  // Parse minHour and maxHour
  const [minHour, minMinute] = config.minHour.split(':').map(Number);
  const [maxHour, maxMinute] = config.maxHour.split(':').map(Number);

  // Calculate max time in UTC
  const maxTime = (date: moment.Moment) =>
    date
      .clone()
      .set({ hour: maxHour, minute: maxMinute, second: 0, millisecond: 0 });

  // Iterate through each day
  for (let dayOffset = 0; dayOffset < days; dayOffset++) {
    const currentDate = moment
      .utc(startDate)
      .add(dayOffset, 'days')
      .startOf('day');
    const dateISO = currentDate.format('YYYY-MM-DD');

    let effectiveMinHour: number;
    let effectiveMinMinute: number;

    const maxTimeForDay = maxTime(currentDate);

    if (dayOffset === 0 && clientCurrentTime) {
      const clientCurrentDateStr = clientCurrentTime.format('YYYY-MM-DD');

      if (clientCurrentDateStr === dateISO) {
        effectiveMinHour = clientCurrentTime.hour();
        effectiveMinMinute = clientCurrentTime.minute();

        // Round up to next slot interval
        const minutesToAdd = slotDuration - (effectiveMinMinute % slotDuration);
        if (minutesToAdd < slotDuration) {
          effectiveMinMinute += minutesToAdd;
          if (effectiveMinMinute >= 60) {
            effectiveMinHour += 1;
            effectiveMinMinute -= 60;
          }
        }

        // Ensure we don't go below minHour
        const minTime = currentDate
          .clone()
          .set({ hour: minHour, minute: minMinute, second: 0, millisecond: 0 });
        const currentTimeMoment = currentDate
          .clone()
          .set({
            hour: effectiveMinHour,
            minute: effectiveMinMinute,
            second: 0,
            millisecond: 0,
          });

        if (currentTimeMoment.isBefore(minTime)) {
          effectiveMinHour = minHour;
          effectiveMinMinute = minMinute;
        }

        // Check if current time is already past maxHour
        const finalMinTime = currentDate
          .clone()
          .set({
            hour: effectiveMinHour,
            minute: effectiveMinMinute,
            second: 0,
            millisecond: 0,
          });

        if (
          finalMinTime.isAfter(maxTimeForDay) ||
          finalMinTime.isSame(maxTimeForDay)
        ) {
          console.log(
            `Skipping ${dateISO} - current time (${effectiveMinHour}:${effectiveMinMinute
              .toString()
              .padStart(2, '0')}) is at or past maxHour (${maxHour}:${maxMinute
              .toString()
              .padStart(2, '0')})`,
          );
          continue;
        }
      } else {
        console.log(
          `Skipping ${dateISO} - client current time is on different day (${clientCurrentDateStr})`,
        );
        continue;
      }
    } else {
      effectiveMinHour = minHour;
      effectiveMinMinute = minMinute;
    }

    let currentSlotStart = currentDate
      .clone()
      .set({
        hour: effectiveMinHour,
        minute: effectiveMinMinute,
        second: 0,
        millisecond: 0,
      });
    const maxTimeForDayFinal = maxTime(currentDate);

    // Generate slots for this day
    while (currentSlotStart.isBefore(maxTimeForDayFinal)) {
      const currentSlotEnd = currentSlotStart
        .clone()
        .add(slotDuration, 'minutes');

      if (currentSlotEnd.isAfter(maxTimeForDayFinal)) {
        break;
      }

      baseSlots.push({
        date: dateISO,
        start: currentSlotStart.clone(),
        end: currentSlotEnd.clone(),
        startISO: currentSlotStart.toISOString(),
        endISO: currentSlotEnd.toISOString(),
      });

      currentSlotStart = currentSlotEnd.clone();
    }
  }

  return baseSlots;
}

// Test scenarios
console.log('=== TEST 1: Today at 10:00 AM ===');
const today10AM = moment
  .utc()
  .set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
const startDate1 = moment.utc(today10AM).startOf('day');
const slots1 = generateBaseSlots(
  startDate1,
  1,
  mockService.measure + config.splitTime,
  config,
  0,
  today10AM,
);
console.log(`Generated ${slots1.length} slots for today starting at 10:00 AM`);
slots1.slice(0, 5).forEach((slot) => {
  console.log(
    `  ${slot.start.format('YYYY-MM-DD HH:mm')} - ${slot.end.format('HH:mm')}`,
  );
});
if (slots1.length > 5) console.log(`  ... and ${slots1.length - 5} more slots`);

console.log('\n=== TEST 2: Today at 7:00 PM (19:00) - should skip today ===');
const today7PM = moment
  .utc()
  .set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
const startDate2 = moment.utc(today7PM).startOf('day');
const slots2 = generateBaseSlots(
  startDate2,
  1,
  mockService.measure + config.splitTime,
  config,
  0,
  today7PM,
);
console.log(`Generated ${slots2.length} slots for today starting at 7:00 PM`);
if (slots2.length === 0) {
  console.log('  ✓ Correctly skipped today (past maxHour)');
} else {
  slots2.forEach((slot) => {
    console.log(
      `  ${slot.start.format('YYYY-MM-DD HH:mm')} - ${slot.end.format(
        'HH:mm',
      )}`,
    );
  });
}

console.log('\n=== TEST 3: Tomorrow (future date) ===');
const tomorrow = moment.utc().add(1, 'day').startOf('day');
const startDate3 = tomorrow.clone();
const slots3 = generateBaseSlots(
  startDate3,
  1,
  mockService.measure + config.splitTime,
  config,
  0,
);
console.log(`Generated ${slots3.length} slots for tomorrow`);
slots3.slice(0, 5).forEach((slot) => {
  console.log(
    `  ${slot.start.format('YYYY-MM-DD HH:mm')} - ${slot.end.format('HH:mm')}`,
  );
});
if (slots3.length > 5) console.log(`  ... and ${slots3.length - 5} more slots`);

console.log(
  '\n=== TEST 4: Today at 8:30 AM (should start at 8:30, not 8:00) ===',
);
const today830AM = moment
  .utc()
  .set({ hour: 8, minute: 30, second: 0, millisecond: 0 });
const startDate4 = moment.utc(today830AM).startOf('day');
const slots4 = generateBaseSlots(
  startDate4,
  1,
  mockService.measure + config.splitTime,
  config,
  0,
  today830AM,
);
console.log(`Generated ${slots4.length} slots for today starting at 8:30 AM`);
if (slots4.length > 0) {
  console.log(
    `  First slot: ${slots4[0].start.format(
      'YYYY-MM-DD HH:mm',
    )} - ${slots4[0].end.format('HH:mm')}`,
  );
  if (slots4[0].start.hour() === 8 && slots4[0].start.minute() === 30) {
    console.log('  ✓ Correctly starts at 8:30');
  } else {
    console.log(
      `  ✗ Should start at 8:30, but starts at ${slots4[0].start.format(
        'HH:mm',
      )}`,
    );
  }
}

console.log(
  '\n=== TEST 5: Today at 7:45 AM (should round up to 8:00 if slotDuration is 30) ===',
);
const today745AM = moment
  .utc()
  .set({ hour: 7, minute: 45, second: 0, millisecond: 0 });
const startDate5 = moment.utc(today745AM).startOf('day');
const slots5 = generateBaseSlots(startDate5, 1, 30, config, 0, today745AM);
console.log(`Generated ${slots5.length} slots for today starting at 7:45 AM`);
if (slots5.length > 0) {
  console.log(
    `  First slot: ${slots5[0].start.format(
      'YYYY-MM-DD HH:mm',
    )} - ${slots5[0].end.format('HH:mm')}`,
  );
  if (slots5[0].start.hour() === 8 && slots5[0].start.minute() === 0) {
    console.log('  ✓ Correctly rounded up to 8:00');
  } else {
    console.log(
      `  ✗ Should round up to 8:00, but starts at ${slots5[0].start.format(
        'HH:mm',
      )}`,
    );
  }
} else {
  console.log('  ✗ No slots generated (should have slots starting at 8:00)');
}
