import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';

const logger = new Logger('Cloudinary');

export type CloudinaryFailureCode =
  | 'not_configured'
  | 'configuration_incomplete'
  | 'permission_denied'
  | 'authentication_failed'
  | 'request_rejected'
  | 'service_unavailable';

export class CloudinaryStorageError extends Error {
  constructor(
    public readonly code: CloudinaryFailureCode,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'CloudinaryStorageError';
  }
}

type CloudinaryAsset = {
  public_id: string;
  secure_url: string;
  resource_type: string;
  bytes: number;
  version?: number;
  width?: number;
  height?: number;
  format?: string;
};

function config() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim();
  const apiKey = process.env.CLOUDINARY_API_KEY?.trim();
  const apiSecret = process.env.CLOUDINARY_API_SECRET?.trim();
  if ([cloudName, apiKey, apiSecret].some(Boolean) && !(cloudName && apiKey && apiSecret))
    throw new CloudinaryStorageError(
      'configuration_incomplete',
      'Cloudinary configuration requires cloud name, API key, and API secret',
    );
  return cloudName && apiKey && apiSecret
    ? { cloudName, apiKey, apiSecret }
    : null;
}

export function cloudinaryConfigured() {
  return !!config();
}

function signature(params: Record<string, string>, apiSecret: string) {
  const payload = Object.entries(params)
    .filter(([, value]) => value !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  return createHash('sha1')
    .update(payload + apiSecret)
    .digest('hex');
}

export async function uploadCloudinaryFile(
  content: Buffer,
  mimeType: string,
  publicId: string,
  deliveryType: 'upload' | 'authenticated' = 'upload',
  resourceTypeOverride: 'image' | 'raw' | 'auto' = 'auto',
): Promise<CloudinaryAsset> {
  const settings = config();
  if (!settings)
    throw new CloudinaryStorageError(
      'not_configured',
      'Cloudinary storage is not configured',
    );
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = {
    invalidate: 'true',
    overwrite: 'true',
    public_id: publicId,
    timestamp,
  };
  const resourceType = resourceTypeOverride === 'auto'
    ? (mimeType === 'application/pdf' ? 'raw' : 'image')
    : resourceTypeOverride;
  // `type` is a signed Cloudinary upload parameter. It must be included in
  // the signature as well as the multipart body. Thumbnail uploads use the
  // default `upload` type, but sensitive receipts use `authenticated`.
  const signedParams = deliveryType === 'upload'
    ? params
    : { ...params, type: deliveryType };
  const form = new FormData();
  form.append(
    'file',
    new Blob([Uint8Array.from(content)], { type: mimeType }),
    publicId.split('/').pop() ?? 'receipt',
  );
  if (deliveryType !== 'upload') form.append('type', deliveryType);
  form.append('api_key', settings.apiKey);
  form.append('signature', signature(signedParams, settings.apiSecret));
  for (const [key, value] of Object.entries(signedParams)) form.append(key, value);
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${settings.cloudName}/${resourceType}/upload`,
    { method: 'POST', body: form },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let providerMessage = 'unknown provider error';
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } };
      if (typeof parsed.error?.message === 'string') providerMessage = parsed.error.message;
    } catch {
      if (detail.trim()) providerMessage = detail.trim().replace(/\s+/g, ' ').slice(0, 240);
    }
    const lower = providerMessage.toLowerCase();
    const code: CloudinaryFailureCode =
      response.status === 401 || lower.includes('invalid api')
        ? 'authentication_failed'
        : response.status === 403 &&
            (lower.includes('permission') || lower.includes('forbidden'))
          ? 'permission_denied'
          : response.status >= 500
            ? 'service_unavailable'
            : 'request_rejected';
    const safeMessage =
      code === 'permission_denied'
        ? 'Cloudinary rejected the upload because this API key does not have create/upload permission.'
        : code === 'authentication_failed'
          ? 'Cloudinary rejected the upload credentials.'
          : `Cloudinary rejected the upload (HTTP ${response.status}).`;
    logger.error(
      `upload failed status=${response.status} code=${code} resource_type=${resourceType} delivery_type=${deliveryType} public_id_prefix=${publicId.slice(0, 48)} provider_message=${providerMessage}`,
    );
    throw new CloudinaryStorageError(code, safeMessage, response.status);
  }
  const result = (await response.json()) as Partial<CloudinaryAsset>;
  if (!result.public_id || !result.secure_url)
    throw new CloudinaryStorageError(
      'request_rejected',
      'Cloudinary returned an incomplete upload response',
    );
  return {
    public_id: result.public_id,
    secure_url: result.secure_url,
    resource_type: resourceType,
    bytes: Number((result as { bytes?: number }).bytes ?? content.byteLength),
    version: Number((result as { version?: number }).version ?? 0) || undefined,
    width: Number((result as { width?: number }).width ?? 0) || undefined,
    height: Number((result as { height?: number }).height ?? 0) || undefined,
    format: typeof (result as { format?: unknown }).format === 'string' ? (result as { format: string }).format : undefined,
  };
}

export const uploadCloudinaryImage = uploadCloudinaryFile;

export async function deleteCloudinaryImage(
  publicId: string,
  deliveryType: 'upload' | 'authenticated' = 'upload',
  resourceType: 'image' | 'raw' = 'image',
) {
  const settings = config();
  if (!settings) return;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { invalidate: 'true', public_id: publicId, timestamp, ...(deliveryType !== 'upload' ? { type: deliveryType } : {}) };
  const form = new URLSearchParams({
    ...params,
    api_key: settings.apiKey,
    signature: signature(params, settings.apiSecret),
  });
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${settings.cloudName}/${resourceType}/destroy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form,
    },
  );
  if (!response.ok)
    throw new Error(`Cloudinary delete failed (${response.status})`);
}

export async function fetchCloudinaryImage(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok)
    throw new Error(`Cloudinary image fetch failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}
