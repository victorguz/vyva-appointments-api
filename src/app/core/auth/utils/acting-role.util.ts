/**
 * Rol secundario del superadmin («ver como…»).
 *
 * El superadmin puede ejercer temporalmente otro rol para ver Vyva como lo ve ese
 * rol. El rol real no cambia en la base de datos: el servicio de cambio de rol
 * (`PATCH /auth/update-role`) emite un JWT con el claim `actingRole`, que el
 * authorizer pasa en el contexto y cada guardián aplica aquí. Un inicio de sesión
 * nunca emite ese claim, así que siempre se arranca como superadmin.
 */
export const ACTING_ROLES = ['admin', 'employee', 'supermarketing'] as const;

export type ActingRole = (typeof ACTING_ROLES)[number];

export function isActingRole(value: unknown): value is ActingRole {
  return (
    typeof value === 'string' && (ACTING_ROLES as readonly string[]).includes(value)
  );
}

/**
 * Sustituye el rol de la petición por el rol secundario. Solo vale si el rol real
 * (el de la base de datos) es `superadmin` y el claim está en la lista: nunca
 * sube de nivel, así que un claim fabricado no le sirve a un admin o a un empleado.
 * El rol real queda en `realRole`.
 */
export function applyActingRole(
  user: { role?: unknown },
  actingRole?: unknown,
): void {
  if (user.role !== 'superadmin' || !isActingRole(actingRole)) return;
  (user as any).realRole = 'superadmin';
  (user as any).role = actingRole;
}

/** El rol secundario con el que se está ejerciendo (`undefined` si es el rol real). */
export function actingRoleOf(user: {
  role?: unknown;
  realRole?: unknown;
}): ActingRole | undefined {
  return user.realRole === 'superadmin' && isActingRole(user.role)
    ? user.role
    : undefined;
}
