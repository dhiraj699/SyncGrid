export const Role = Object.freeze({ ADMIN: 'ADMIN', MANAGER: 'MANAGER', STAFF: 'STAFF' });
export const ROLES = Object.freeze(Object.values(Role));

/** Higher priority wins when two concurrent edits are otherwise indistinguishable. */
export const ROLE_PRIORITY = Object.freeze({ ADMIN: 3, MANAGER: 2, STAFF: 1 });

export const Permission = Object.freeze({
  CONFIDENTIAL_READ: 'CONFIDENTIAL_READ',
  CONFIDENTIAL_WRITE: 'CONFIDENTIAL_WRITE',
  UNRESTRICTED_WRITE: 'UNRESTRICTED_WRITE',
  SCHEMA_WRITE: 'SCHEMA_WRITE',
  AUDIT_READ: 'AUDIT_READ',
});

const GRANTS = Object.freeze({
  [Role.ADMIN]: new Set(Object.values(Permission)),
  [Role.MANAGER]: new Set([
    Permission.CONFIDENTIAL_READ,
    Permission.CONFIDENTIAL_WRITE,
    Permission.UNRESTRICTED_WRITE,
  ]),
  [Role.STAFF]: new Set(),
});

export const can = (role, permission) => GRANTS[role]?.has(permission) ?? false;

/**
 * Resolves what a role may do with a column. Staff may only write columns
 * explicitly flagged `staffEditable`, and never see or write confidential ones.
 * @returns {{ canRead: boolean, canWrite: boolean }}
 */
export function permissionMaskFor(role, column) {
  if (column.confidential) {
    const canRead = can(role, Permission.CONFIDENTIAL_READ);
    return { canRead, canWrite: canRead && can(role, Permission.CONFIDENTIAL_WRITE) };
  }
  return {
    canRead: true,
    canWrite: can(role, Permission.UNRESTRICTED_WRITE) || Boolean(column.staffEditable),
  };
}
