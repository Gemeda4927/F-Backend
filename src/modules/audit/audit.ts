import type { Prisma } from '../../generated/prisma/client.js';
import type { CurrentUser } from '../../common/types.js';

function redactText(value: string) {
  return value
    .replace(/\b(password|passphrase|token|secret|credential|authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted email]');
}

// Audit payloads are deliberately bounded and redact secrets even if a future caller passes them.
export function redact(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) return '[not set]';
  if (Array.isArray(value)) return value.slice(0, 50).map(redact);
  if (typeof value === 'object') return Object.fromEntries(
    Object.entries(value).slice(0, 50).map(([key, item]) => [key,
      /password|token|secret|credential|hash|cookie|authorization|email|phone/i.test(key)
        ? '[redacted]' : redact(item)]),
  );
  if (typeof value === 'string') return redactText(value.slice(0, 1000));
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  return '[unsupported value]';
}
export function audit(tx: Prisma.TransactionClient, input: {
  actor?: Pick<CurrentUser, 'id' | 'name' | 'role'>;
  target: string; action: string; description: string;
  resourceType?: string; resourceId?: string; reason?: string;
  oldValues?: unknown; newValues?: unknown; metadata?: unknown;
}) {
  return tx.auditLog.create({ data: {
    actor_id: input.actor?.id, actor_name: input.actor?.name ?? 'System',
    actor_role: input.actor?.role ?? 'SYSTEM', target_id: input.target,
    action: input.action, description: input.description,
    resource_type: input.resourceType ?? 'USER', resource_id: input.resourceId ?? input.target,
    reason: input.reason === undefined ? undefined : redactText(input.reason), old_values: input.oldValues === undefined ? undefined : redact(input.oldValues),
    new_values: input.newValues === undefined ? undefined : redact(input.newValues),
    metadata: input.metadata === undefined ? undefined : redact(input.metadata),
  } });
}
