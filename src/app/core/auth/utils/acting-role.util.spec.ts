import { actingRoleOf, applyActingRole, isActingRole } from './acting-role.util';

describe('Rol secundario del superadmin', () => {
  it('solo acepta los roles de la lista', () => {
    expect(
      ['admin', 'employee', 'supermarketing', 'community_manager'].every(isActingRole),
    ).toBe(true);
    expect(isActingRole('superadmin')).toBe(false);
    expect(isActingRole('customer')).toBe(false);
    expect(isActingRole(undefined)).toBe(false);
  });

  it('el superadmin ejerce el rol del claim y conserva el real', () => {
    const user: any = { id: 'u1', role: 'superadmin' };
    applyActingRole(user, 'employee');
    expect(user.role).toBe('employee');
    expect(user.realRole).toBe('superadmin');
    expect(actingRoleOf(user)).toBe('employee');
  });

  it('nunca sube de nivel: un claim en otro rol no hace nada', () => {
    for (const role of ['admin', 'employee', 'supermarketing', 'customer']) {
      const user: any = { id: 'u1', role };
      applyActingRole(user, 'admin');
      expect(user.role).toBe(role);
      expect(user.realRole).toBeUndefined();
    }
  });

  it('un claim fuera de la lista, o ausente, se ignora', () => {
    const user: any = { id: 'u1', role: 'superadmin' };
    applyActingRole(user, 'superadmin');
    applyActingRole(user, 'vyva');
    applyActingRole(user, undefined);
    expect(user.role).toBe('superadmin');
    expect(actingRoleOf(user)).toBeUndefined();
  });
});
