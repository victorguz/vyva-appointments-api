import { Integration } from '../schemas/integration.schema';

export function integrationRowTimestamp(row: {
  updatedAt?: Date;
  createdAt?: Date;
}): number {
  const updated = row.updatedAt ? new Date(row.updatedAt).getTime() : 0;
  const created = row.createdAt ? new Date(row.createdAt).getTime() : 0;
  return Math.max(updated, created);
}

/** One integration row per business + type (prefer active, then most recently updated). */
export function selectCanonicalIntegrationRow(
  rows: Integration[],
): Integration | null {
  if (!rows?.length) {
    return null;
  }

  return [...rows].sort((a, b) => {
    if (a.isActive !== b.isActive) {
      return a.isActive ? -1 : 1;
    }
    return integrationRowTimestamp(b) - integrationRowTimestamp(a);
  })[0];
}

export function listDuplicateIntegrationRows(
  rows: Integration[],
  canonicalId: string,
): Integration[] {
  return rows.filter((row) => row.id !== canonicalId);
}
