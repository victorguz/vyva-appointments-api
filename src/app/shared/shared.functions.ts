import * as CryptoJS from 'crypto-js';

export function encrypt(data: string): string {
  const encrypted = CryptoJS.AES.encrypt(data, process.env.SECRET_KEY!);
  return encrypted.toString();
}

export function decrypt(data: string): string {
  const bytes = CryptoJS.AES.decrypt(data, process.env.SECRET_KEY!);
  return bytes.toString(CryptoJS.enc.Utf8);
}

/** Colombia móvil: 10 dígitos que empiezan por 3 → antepone 57 para WhatsApp. */
export function normalizeColombiaWaPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) {
    return '';
  }
  if (digits.length === 10 && digits.startsWith('3')) {
    return `57${digits}`;
  }
  return digits;
}

export function deleteEmptyProperties<T extends Record<string, unknown>>(
  obj: T,
): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}
