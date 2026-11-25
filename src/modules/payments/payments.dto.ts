import { IsDateString, IsIn, IsNumberString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
export class CreatePaymentDto {
  @IsUUID() course_id!: string;
  @IsUUID() idempotency_key!: string;
}

export class ManualPaymentDto {
  @IsUUID() course_id!: string;
  @IsIn(['CBE', 'TELEBIRR']) payment_method!: 'CBE' | 'TELEBIRR';
  @IsString() @MinLength(2) @MaxLength(120) payer_name!: string;
  @IsOptional() @IsString() @MaxLength(120) reference_number?: string;
  @IsNumberString() amount_paid!: string;
  @IsDateString() payment_date!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class PaymentDecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) remark?: string;
}
