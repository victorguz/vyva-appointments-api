/**
 * Simple test script for timeslots logic
 * Run with: node test-timeslots-simple.js
 */

const moment = require('moment-timezone');

// Mock configuration
const config = {
  minHour: '08:00',
  maxHour: '18:00',
  splitTime: 5,
};

const slotDuration = 30 + config.splitTime; // 35 minutes

// Parse hours
const [minHour, minMinute] = config.minHour.split(':').map(Number);
const [maxHour, maxMinute] = config.maxHour.split(':').map(Number);

function generateSlotsForDay(date, clientCurrentTime, isToday) {
  const slots = [];
  const currentDate = moment.utc(date).startOf('day');
  const dateISO = currentDate.format('YYYY-MM-DD');
  
  const maxTime = currentDate.clone().set({ hour: maxHour, minute: maxMinute, second: 0, millisecond: 0 });
  
  let effectiveMinHour, effectiveMinMinute;
  
  if (isToday && clientCurrentTime) {
    const clientCurrentDateStr = clientCurrentTime.format('YYYY-MM-DD');
    
    if (clientCurrentDateStr === dateISO) {
      const minTime = currentDate.clone().set({ hour: minHour, minute: minMinute, second: 0, millisecond: 0 });
      const currentTimeMoment = clientCurrentTime.clone();
      
      // If current time is before minHour, use minHour
      if (currentTimeMoment.isBefore(minTime)) {
        effectiveMinHour = minHour;
        effectiveMinMinute = minMinute;
      } else {
        // Current time is at or after minHour
        // Round up to next slot interval only if not already on a slot boundary
        effectiveMinHour = clientCurrentTime.hour();
        effectiveMinMinute = clientCurrentTime.minute();
        
        // Check if we're already on a slot boundary
        const remainder = effectiveMinMinute % slotDuration;
        if (remainder !== 0) {
          // Not on a slot boundary, round up
          const minutesToAdd = slotDuration - remainder;
          effectiveMinMinute += minutesToAdd;
          if (effectiveMinMinute >= 60) {
            effectiveMinHour += 1;
            effectiveMinMinute -= 60;
          }
        }
        
        // Verify the rounded time is still at or after minHour
        const roundedTime = currentDate.clone().set({ hour: effectiveMinHour, minute: effectiveMinMinute, second: 0, millisecond: 0 });
        
        if (roundedTime.isBefore(minTime)) {
          // Rounded time is before minHour, use minHour instead
          effectiveMinHour = minHour;
          effectiveMinMinute = minMinute;
        }
      }
      
      // Check if past maxHour
      const finalMinTime = currentDate.clone().set({ hour: effectiveMinHour, minute: effectiveMinMinute, second: 0, millisecond: 0 });
      
      if (finalMinTime.isAfter(maxTime) || finalMinTime.isSame(maxTime)) {
        return { dateISO, slots: [], reason: 'Current time is at or past maxHour' };
      }
    } else {
      return { dateISO, slots: [], reason: 'Client time is on different day' };
    }
  } else {
    effectiveMinHour = minHour;
    effectiveMinMinute = minMinute;
  }
  
  let currentSlotStart = currentDate.clone().set({ hour: effectiveMinHour, minute: effectiveMinMinute, second: 0, millisecond: 0 });
  
  while (currentSlotStart.isBefore(maxTime)) {
    const currentSlotEnd = currentSlotStart.clone().add(slotDuration, 'minutes');
    
    if (currentSlotEnd.isAfter(maxTime)) {
      break;
    }
    
    slots.push({
      start: currentSlotStart.clone(),
      end: currentSlotEnd.clone(),
    });
    
    currentSlotStart = currentSlotEnd.clone();
  }
  
  return { dateISO, slots };
}

console.log('=== TEST 1: Today at 10:00 AM UTC ===');
const today10AM = moment.utc().set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
const today = moment.utc().startOf('day');
const result1 = generateSlotsForDay(today, today10AM, true);
console.log(`Date: ${result1.dateISO}`);
console.log(`Generated ${result1.slots.length} slots`);
if (result1.slots.length > 0) {
  console.log('First 5 slots:');
  result1.slots.slice(0, 5).forEach((slot, i) => {
    console.log(`  ${i + 1}. ${slot.start.format('HH:mm')} - ${slot.end.format('HH:mm')} UTC`);
  });
  if (result1.slots.length > 5) {
    console.log(`  ... and ${result1.slots.length - 5} more`);
  }
} else {
  console.log(`Reason: ${result1.reason}`);
}

console.log('\n=== TEST 2: Today at 7:00 PM UTC (19:00) - should skip ===');
const today7PM = moment.utc().set({ hour: 19, minute: 0, second: 0, millisecond: 0 });
const result2 = generateSlotsForDay(today, today7PM, true);
console.log(`Date: ${result2.dateISO}`);
console.log(`Generated ${result2.slots.length} slots`);
if (result2.slots.length === 0) {
  console.log(`✓ Correctly skipped: ${result2.reason}`);
} else {
  console.log('✗ Should have skipped but generated slots:');
  result2.slots.slice(0, 3).forEach((slot) => {
    console.log(`  ${slot.start.format('HH:mm')} - ${slot.end.format('HH:mm')} UTC`);
  });
}

console.log('\n=== TEST 3: Today at 8:30 AM UTC ===');
const today830AM = moment.utc().set({ hour: 8, minute: 30, second: 0, millisecond: 0 });
const result3 = generateSlotsForDay(today, today830AM, true);
console.log(`Date: ${result3.dateISO}`);
console.log(`Generated ${result3.slots.length} slots`);
if (result3.slots.length > 0) {
  const firstSlot = result3.slots[0];
  console.log(`First slot: ${firstSlot.start.format('HH:mm')} - ${firstSlot.end.format('HH:mm')} UTC`);
  // Since slotDuration is 35 minutes, slots are at 8:00, 8:35, 9:10, etc.
  // So 8:30 should round up to 8:35 (next slot boundary)
  if (firstSlot.start.hour() === 8 && firstSlot.start.minute() === 35) {
    console.log('✓ Correctly rounds up to 8:35 (next slot boundary)');
  } else {
    console.log(`✗ Should round up to 8:35, but starts at ${firstSlot.start.format('HH:mm')}`);
  }
}

console.log('\n=== TEST 4: Tomorrow (future date) ===');
const tomorrow = moment.utc().add(1, 'day').startOf('day');
const result4 = generateSlotsForDay(tomorrow, null, false);
console.log(`Date: ${result4.dateISO}`);
console.log(`Generated ${result4.slots.length} slots`);
if (result4.slots.length > 0) {
  console.log('First 5 slots:');
  result4.slots.slice(0, 5).forEach((slot, i) => {
    console.log(`  ${i + 1}. ${slot.start.format('HH:mm')} - ${slot.end.format('HH:mm')} UTC`);
  });
  if (result4.slots[0].start.hour() === minHour && result4.slots[0].start.minute() === minMinute) {
    console.log('✓ Correctly starts at minHour (08:00)');
  }
}

console.log('\n=== TEST 5: Today at 7:45 AM UTC (should round up to 8:00 if slotDuration is 35) ===');
const today745AM = moment.utc().set({ hour: 7, minute: 45, second: 0, millisecond: 0 });
const result5 = generateSlotsForDay(today, today745AM, true);
console.log(`Date: ${result5.dateISO}`);
console.log(`Generated ${result5.slots.length} slots`);
if (result5.slots.length > 0) {
  const firstSlot = result5.slots[0];
  console.log(`First slot: ${firstSlot.start.format('HH:mm')} - ${firstSlot.end.format('HH:mm')} UTC`);
  // Should round 7:45 + 35min = 8:20, but we check minHour first, so should be 8:00
  if (firstSlot.start.hour() === 8 && firstSlot.start.minute() === 0) {
    console.log('✓ Correctly starts at 8:00 (minHour)');
  } else {
    console.log(`✗ Should start at 8:00, but starts at ${firstSlot.start.format('HH:mm')}`);
  }
} else {
  console.log('✗ No slots generated');
}

