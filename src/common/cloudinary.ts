import { createHash } from 'node:crypto';

type CloudinaryAsset = {
  public_id: string;
  secure_url: string;
  resource_type: string;
  bytes: number;
};

function config() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (
    [cloudName, apiKey, apiSecret].some(Boolean) &&
    !(cloudName && apiKey && apiSecret)
  )
    throw new Error(
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
): Promise<CloudinaryAsset> {
  const settings = config();
  if (!settings) throw new Error('Cloudinary storage is not configured');
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = {
    invalidate: 'true',
    overwrite: 'true',
    public_id: publicId,
    timestamp,
  };
  const resourceType = mimeType === 'application/pdf' ? 'raw' : 'image';
  const form = new FormData();
  form.append(
    'file',
    new Blob([Uint8Array.from(content)], { type: mimeType }),
    publicId.split('/').pop() ?? 'receipt',
  );
  if (deliveryType !== 'upload') form.append('type', deliveryType);
  form.append('api_key', settings.apiKey);
  form.append('signature', signature(params, settings.apiSecret));
  for (const [key, value] of Object.entries(params)) form.append(key, value);
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${settings.cloudName}/${resourceType}/upload`,
    { method: 'POST', body: form },
  );
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Cloudinary upload failed (${response.status})${detail ? `: ${detail.slice(0, 300)}` : ''}`,
    );
  }
  const result = (await response.json()) as Partial<CloudinaryAsset>;
  if (!result.public_id || !result.secure_url)
    throw new Error('Cloudinary returned an incomplete upload response');
  return {
    public_id: result.public_id,
    secure_url: result.secure_url,
    resource_type: resourceType,
    bytes: Number((result as { bytes?: number }).bytes ?? content.byteLength),
  };
}

export const uploadCloudinaryImage = uploadCloudinaryFile;

export async function deleteCloudinaryImage(publicId: string) {
  const settings = config();
  if (!settings) return;
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const params = { invalidate: 'true', public_id: publicId, timestamp };
  const form = new URLSearchParams({
    ...params,
    api_key: settings.apiKey,
    signature: signature(params, settings.apiSecret),
  });
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${settings.cloudName}/image/destroy`,
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
