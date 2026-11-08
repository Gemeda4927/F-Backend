import type { Request } from 'express';
export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'INSTRUCTOR' | 'STUDENT';
export interface CurrentUser {
  permissions?: readonly string[];
  id: string;
  email: string;
  name: string;
  role: Role;
  sessionId: string;
}
export interface AuthRequest extends Request {
  user: CurrentUser;
  cookies: Record<string, string>;
}
export interface UserRecord {
  id: string;
  email: string;
  name: string;
  role: Role;
  active: boolean;
  password_hash: string;
}
