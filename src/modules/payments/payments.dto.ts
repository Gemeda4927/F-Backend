import { IsUUID } from 'class-validator';
export class CreatePaymentDto {
  @IsUUID() course_id!: string;
  @IsUUID() idempotency_key!: string;
}
