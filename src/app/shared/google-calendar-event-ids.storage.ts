/**
 * Stores Google Calendar event ids for an appointment in a single string field
 * (`googleCalendarEventId`) as JSON.stringify of
 * `[{ role: 'employee' | 'customer', eventId: string }, ...]`.
 * Legacy: a plain non-JSON string is treated as a single employee event id.
 */

export type GoogleCalendarEventRef = {
  role: 'employee' | 'customer';
  eventId: string;
};

export function parseGoogleCalendarEventIds(stored: string | undefined | null): {
  refs: GoogleCalendarEventRef[];
  employeeEventId?: string;
  customerEventId?: string;
} {
  if (!stored?.trim()) {
    return { refs: [] };
  }
  const s = stored.trim();
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) {
      const refs: GoogleCalendarEventRef[] = [];
      for (const item of parsed) {
        if (item && typeof item === 'object' && 'eventId' in item) {
          const role =
            item.role === 'customer' ? 'customer' : 'employee';
          refs.push({ role, eventId: String(item.eventId) });
        }
      }
      if (refs.length > 0) {
        return {
          refs,
          employeeEventId: refs.find((r) => r.role === 'employee')?.eventId,
          customerEventId: refs.find((r) => r.role === 'customer')?.eventId,
        };
      }
    }
  } catch {
    // legacy plain id
  }
  return {
    refs: [{ role: 'employee', eventId: s }],
    employeeEventId: s,
  };
}

export function serializeGoogleCalendarEventIds(
  employeeEventId: string,
  customerEventId?: string | null,
): string {
  const refs: GoogleCalendarEventRef[] = [
    { role: 'employee', eventId: employeeEventId },
  ];
  if (customerEventId) {
    refs.push({ role: 'customer', eventId: customerEventId });
  }
  return JSON.stringify(refs);
}

export function hasCustomerGoogleCalendarEvent(
  stored: string | undefined | null,
): boolean {
  return !!parseGoogleCalendarEventIds(stored).customerEventId;
}
