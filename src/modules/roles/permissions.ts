import type { Role } from '../../common/types.js';
export type Permission =
  | 'users:manage'
  | 'roles:manage'
  | 'devices:reset'
  | 'courses:write'
  | 'payments:review'
  | 'access:revoke'
  | 'payments:refund';
const grants: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: [
    'users:manage',
    'roles:manage',
    'devices:reset',
    'courses:write',
    'payments:review',
    'payments:refund',
    'access:revoke',
  ],
  ADMIN: [
    'users:manage',
    'devices:reset',
    'courses:write',
    'payments:review',
    'payments:refund',
    'access:revoke',
  ],
  INSTRUCTOR: ['courses:write'],
  STUDENT: [],
};
export function hasPermission(role: Role, permission: Permission) {
  return grants[role].includes(permission);
}
