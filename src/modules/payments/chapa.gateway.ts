import {
  BadGatewayException,
  Injectable,
  Logger,
  UnprocessableEntityException,
  ServiceUnavailableException,
} from '@nestjs/common';
// Return fixed labels only; never log arbitrary provider text or reflected values.
export function chapaFailureReason(message: unknown): string {
  if (typeof message !== 'string') return 'UNCLASSIFIED';
  if (/invalid api key|authorization required|unauthori[sz]ed/i.test(message))
    return 'AUTHENTICATION_REJECTED';
  if (
    /can.t receive payments|cannot receive payments|api is disabled|payments through api.*disabled/i.test(
      message,
    )
  )
    return 'MERCHANT_PAYMENTS_DISABLED';
  if (/currency.*not supported|invalid currency/i.test(message))
    return 'CURRENCY_UNSUPPORTED';
  if (/reference.*used before|reference.*already.*used/i.test(message))
    return 'REFERENCE_ALREADY_USED';
  if (/share.*not enough.*fee|fee.*greater.*amount/i.test(message))
    return 'MERCHANT_FEE_CONFIGURATION';
  if (/incorrect header|content-type/i.test(message)) return 'HEADERS_REJECTED';
  return 'UNCLASSIFIED';
}
// Chapa v1 rejects punctuation outside this character set, even in course titles.
export function chapaDescription(title: string): string {
  return (
    title
      .replace(/[^a-zA-Z0-9_. -]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50) || 'Course enrollment'
  );
}
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
  private readonly logger = new Logger(ChapaGateway.name);
  private async request(
    path: string,
    body?: unknown,
    resource = 'transaction/',
  ) {
    if (!process.env.CHAPA_SECRET_KEY)
      throw new ServiceUnavailableException(
        'Chapa is not configured. Contact support.',
      );
    let response: Response;
    try {
      response = await fetch('https://api.chapa.co/v1/' + resource + path, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: 'Bearer ' + process.env.CHAPA_SECRET_KEY,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      this.logger.warn('Chapa v1 network request failed');
      throw new ServiceUnavailableException(
        'Unable to reach Chapa. Please try again shortly.',
      );
    }
    const result = (await response.json().catch(() => null)) as {
      status?: string;
      message?: unknown;
      data?: Record<string, unknown>;
    } | null;
    if (!response.ok) {
      // Log only known field names and HTTP status. Provider bodies may contain PII.
      const fields =
        result?.message && typeof result.message === 'object'
          ? Object.keys(result.message).filter((field) =>
              [
                'email',
                'amount',
                'currency',
                'first_name',
                'last_name',
                'tx_ref',
                'callback_url',
                'return_url',
                'customization.title',
                'customization.description',
              ].includes(field),
            )
          : [];
      const reason = chapaFailureReason(result?.message);
      this.logger.warn(
        JSON.stringify({
          provider: 'chapa',
          api: 'v1',
          status: response.status,
          fields,
          reason,
          responseFormat: result === null ? 'non-json' : typeof result.message,
        }),
      );
      if ([400, 422].includes(response.status) && fields.includes('email'))
        throw new UnprocessableEntityException(
          'Chapa rejected your account email. Use a valid email address that can receive mail; demo .example addresses cannot be used for checkout.',
        );
      if (reason === 'MERCHANT_PAYMENTS_DISABLED')
        throw new ServiceUnavailableException(
          'The Chapa merchant account cannot receive API payments. Contact support.',
        );
      if (reason === 'CURRENCY_UNSUPPORTED')
        throw new UnprocessableEntityException(
          'Chapa does not support this course currency. Contact support.',
        );
      if (reason === 'REFERENCE_ALREADY_USED')
        throw new BadGatewayException(
          'This payment reference already exists at Chapa. Check Payments before retrying.',
        );
      if (
        [401, 403].includes(response.status) ||
        reason === 'AUTHENTICATION_REJECTED'
      )
        throw new ServiceUnavailableException(
          'Payment configuration could not be authenticated. Contact support.',
        );
      if ([400, 422].includes(response.status))
        throw new BadGatewayException(
          'Chapa rejected the checkout details. Contact support before retrying.',
        );
      throw new ServiceUnavailableException(
        'Chapa is temporarily unavailable. Please try again shortly.',
      );
    }
    if (result?.status !== 'success' || !result.data)
      throw new BadGatewayException(
        'Chapa returned an invalid payment response. Contact support.',
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
