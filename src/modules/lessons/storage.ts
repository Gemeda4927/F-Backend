import { copyFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export const privateRoot = () =>
  resolve(process.env.PRIVATE_STORAGE_DIR ?? 'private-storage');

/** Resolve a stored file name, refusing anything that escapes the private root. */
export function privatePath(name: string) {
  const root = privateRoot(),
    path = resolve(root, name);
  return path.startsWith(root + sep) ? path : null;
}

export function removePrivateFile(name: string | null | undefined) {
  const path = name ? privatePath(name) : null;
  try {
    if (path && existsSync(path)) unlinkSync(path);
  } catch {
    // An orphaned file is harmless; the database row is the source of truth.
  }
}

/** Copy a stored file under a fresh name; returns null when the source is missing. */
export function copyPrivateFile(name: string | null | undefined) {
  const source = name ? privatePath(name) : null;
  if (!source || !existsSync(source)) return null;
  mkdirSync(privateRoot(), { recursive: true });
  const copy = randomUUID() + extname(source);
  copyFileSync(source, resolve(privateRoot(), copy));
  return copy;
}
