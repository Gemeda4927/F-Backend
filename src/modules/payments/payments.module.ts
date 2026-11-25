import {
  Body,
  Controller,
  Get,
  HttpCode,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
  UseInterceptors,
  UploadedFile,
  Query,
  Req,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Throttle } from '@nestjs/throttler';
import {
  Permissions,
  Public,
  User,
} from '../../common/decorators/permissions.js';
import type { CurrentUser } from '../../common/types.js';
import { PaymentsService } from './payments.service.js';
import { ChapaGateway } from './chapa.gateway.js';
import { CreatePaymentDto } from './payments.dto.js';
import { ManualPaymentDto, PaymentDecisionDto } from './payments.dto.js';
import { FileInterceptor } from '@nestjs/platform-express';
import { StudentReasonDto as ReasonDto } from '../students/students.dto.js';
@Controller('payments')
class PaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Post('manual')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  manual(@User() u: CurrentUser, @Body() dto: ManualPaymentDto, @UploadedFile() file?: Express.Multer.File) {
    return this.service.createManual(u, dto, file);
  }
  @Post() @Throttle({ default: { limit: 5, ttl: 60000 } }) create(
    @User() u: CurrentUser,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.service.create(u, dto);
  }
  @Get('me') mine(@User() u: CurrentUser) {
    return this.service.mine(u);
  }
  @Permissions('payments:review') @Get('review') review() {
    return this.service.review();
  }
  @Permissions('payments:review') @Post(':id/approve') approve(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDecisionDto) { return this.service.decideManual(u, id, true, dto.remark); }
  @Permissions('payments:review') @Post(':id/reject') reject(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PaymentDecisionDto) { return this.service.decideManual(u, id, false, dto.remark); }
  @Get(':id/receipt') receipt(@User() u: CurrentUser, @Param('id', ParseUUIDPipe) id: string) { return this.service.receipt(u, id); }
  @Permissions('access:revoke') @Post(':id/revoke') revoke(
    @User() u: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.service.revoke(u, id, dto.reason);
  }
  @Permissions('payments:refund')
  @Post(':id/refund')
  refund(
    @User() user: CurrentUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
  ) {
    return this.service.requestRefund(user, id, dto.reason);
  }
  @Permissions('payments:review')
  @Get(':id/refund')
  refundStatus(@Param('id', ParseUUIDPipe) id: string) {
    return this.service.verifyRefund(id);
  }
  @Get('status/:reference') status(
    @User() u: CurrentUser,
    @Param('reference') reference: string,
  ) {
    return this.service.status(u, reference);
  }
  // An untrusted callback only triggers authenticated server-to-server verification.
  @Public()
  @Get('callback')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  callback(@Query('tx_ref') reference: string) {
    return this.service.verify(reference ?? '');
  }
  @Public()
  @Post('webhook')
  @HttpCode(200)
  webhook(@Req() req: RawBodyRequest<Request>) {
    return this.service.webhook(
      req.rawBody ?? Buffer.alloc(0),
      req.headers['x-chapa-signature'] as string | undefined,
      req.headers['chapa-signature'] as string | undefined,
      req.body,
    );
  }
}
@Module({
  controllers: [PaymentsController],
  providers: [PaymentsService, ChapaGateway],
})
export class PaymentsModule {}
