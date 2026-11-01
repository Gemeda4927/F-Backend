import {
  BadGatewayException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
export function minorUnits(value: unknown): number {
  const text = String(value);
  if (!/^\d+(\.\d{1,2})?$/.test(text))
    throw new BadGatewayException('Invalid gateway amount');
  const [whole, fraction = ''] = text.split('.');
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amount))
    throw new BadGatewayException('Invalid gateway amount');
  return amount;
}
@Injectable()
export class ChapaGateway {
  private async request(
    path: string,
    body?: unknown,
    resource = 'transaction/',
  ) {
    if (!process.env.CHAPA_SECRET_KEY)
      throw new ServiceUnavailableException(
        'Chapa is not configured. Contact support.',
      );
    const response = await fetch('https://api.chapa.co/v1/' + resource + path, {
      method: body ? 'POST' : 'GET',
      headers: {
        Authorization: 'Bearer ' + process.env.CHAPA_SECRET_KEY,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new BadGatewayException(
        'Payment provider unavailable. Please try again.',
      );
    const result = (await response.json()) as {
      status: string;
      data: Record<string, unknown>;
    };
    if (result.status !== 'success' || !result.data)
      throw new BadGatewayException(
        'Payment provider could not process the request',
      );
    return result.data;
  }
  initialize(data: unknown) {
    return this.request('initialize', data);
  }
  verify(reference: string) {
    return this.request('verify/' + encodeURIComponent(reference));
  }
  refund(reference: string, reason: string, requestReference: string) {
    return this.request(
      encodeURIComponent(reference),
      { reason, reference: requestReference },
      'refund/',
    );
  }
  verifyRefund(reference: string) {
    return this.request(
      encodeURIComponent(reference) + '/verify',
      undefined,
      'refund/',
    );
  }
}
