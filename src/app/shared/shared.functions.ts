import * as CryptoJS from 'crypto-js';
import * as moment from 'moment-timezone';
import { DATE_FORMAT } from '../core/constants/generic.constants';
import { isEmpty, isNotEmpty } from 'class-validator';
/**
 * Add days to a date
 * @param date date to modify
 * @param days days to add
 * @returns new date with added days
 */
export function datePlusDays(date: Date | moment.Moment, days: number) {
  return days > 0
    ? moment(date).add(days, 'days')
    : moment(date).subtract(Math.abs(days), 'days');
}

/**
 * Encrypt with AES
 * @param data data to encrypt
 * @returns encrypted data
 */
export function encrypt(data: any) {
  data = CryptoJS.AES.encrypt(data, process.env.SECRET_KEY);
  data = data.toString();
  return data;
}

/**
 * Decrypt with AES
 * @param data encrypted data
 * @returns decrypted data
 */
export function decrypt(data: any) {
  data = CryptoJS.AES.decrypt(data, process.env.SECRET_KEY);
  data = data.toString(CryptoJS.enc.Utf8);
  return data;
}

export function cloneObject(obj: any) {
  return JSON.parse(JSON.stringify(obj));
}

export function deleteEmptyProperties(obj: any) {
  const clon = cloneObject(obj);
  for (const key in clon) {
    if (Object.hasOwn(clon, key) && isEmpty(clon[key])) {
      delete clon[key];
    }
  }
  return clon;
}

export function dataComparison(actual: number, previous: number): number {
  return previous > 0 ? (actual / previous - 1) * 100 : 0;
}

export function getOrderedMonthsFromCurrent(): Array<{
  year: number;
  month: string;
}> {
  const currentDate = new Date();
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();

  const monthNames = [
    'Ene',
    'Feb',
    'Mar',
    'Abr',
    'May',
    'Jun',
    'Jul',
    'Ago',
    'Sep',
    'Oct',
    'Nov',
    'Dic',
  ];

  const last12Months: Array<{ year: number; month: string }> = [];

  for (let i = 0; i < 12; i++) {
    const monthIndex = (currentMonth - i + 12) % 12;
    const year = currentYear - Math.floor((i + 11 - currentMonth) / 12);
    last12Months.push({ year, month: monthNames[monthIndex] });
  }
  last12Months.reverse();

  return last12Months;
}

/**
 * @description This function takes an object with nested properties and flattens it into a single-level object.
 * @param rawObject
 * @returns
 */
export function plainObject(rawObject: any) {
  const result: any = {};

  // Helper function to set nested keys in the result object
  function setNestedKey(key: string, value: any) {
    const keys = key.split('.');
    let current: any = result;

    while (keys.length > 1) {
      const subKey = keys.shift();
      current[subKey] = current[subKey] || {};
      current = current[subKey];
    }

    current[keys[0]] = value;
  }

  // Iterate through each key-value pair in the raw object
  for (const [key, value] of Object.entries(rawObject)) {
    if (key.includes('.')) {
      setNestedKey(key, value);
    } else {
      result[key] = value;
    }
  }

  return result;
}
export function today(): moment.Moment {
  let date = moment(new Date()).tz('America/Bogota');
  return date;
}
export function todayAt00(): moment.Moment {
  const date = today();
  date.startOf('day');
  return date;
}
export function yesterdayAt00(): moment.Moment {
  const date = todayAt00().subtract(1, 'days');
  return date;
}
export function firstDayOfMonthAt00(): moment.Moment {
  let date = todayAt00();
  date.startOf('month');
  return date;
}
export function lastMonthAt00(): moment.Moment {
  const date = todayAt00();
  date.subtract(1, 'month');
  date.startOf('month');
  return date;
}
export function dateDiffHours(date: Date, other: Date) {
  return Math.round((date.getTime() - other.getTime()) / (1000 * 60 * 60));
}
export function formatDate(
  date: moment.MomentInput = moment.now(),
): moment.Moment {
  return moment(date).tz('America/Bogota');
}
export function formatDateToDB(
  date: moment.MomentInput = moment.now(),
): string {
  return formatDate(date).format(DATE_FORMAT.parse.datePg);
}

export function toTitleCase(cad: string, split: string = ' ') {
  cad = cad ? cad.trim().toLowerCase() : '';
  if (isNotEmpty(cad)) {
    let arr = cad.split(split);
    cad = '';
    arr.forEach((e) => {
      if (e) {
        cad += e[0].toUpperCase() + e.substring(1) + ' ';
      }
    });
  }
  return cad;
}
