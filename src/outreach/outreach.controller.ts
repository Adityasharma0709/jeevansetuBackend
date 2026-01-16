import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Req,
} from '@nestjs/common';
import { OutreachService } from './outreach.service';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from 'src/auth/roles/roles.guard';
import { Roles } from 'src/auth/roles.decorator';
import { CreateBeneficiaryDto } from './dto/create-beneficiary.dto';
import { CreateRequestDto } from './dto/create-request.dto';
import { CreateReportDto } from './dto/create-report.dto';

@Controller('outreach')
export class OutreachController {
  constructor(private readonly outreachService: OutreachService) {}

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('beneficiary')
  createBeneficiary(@Body() dto: CreateBeneficiaryDto, @Req() req) {
    return this.outreachService.createBeneficiary(dto, req.user);
  }
  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('OUTREACH')
  @Post('request')
  create(@Body() dto: CreateRequestDto, @Req() req) {
    return this.outreachService.raiseRequest(dto, req.user);
  }
  //beneficiary uppdate request
  @UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OUTREACH')
@Post('beneficiary/:id/request-update')
requestUpdate(
  @Param('id') id: string,
  @Body() dto,
  @Req() req
) {
  return this.outreachService.requestBeneficiaryUpdate(+id, dto, req.user);
}


//report
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('OUTREACH')
@Post('activity-report')
submitReport(
  @Body() dto: CreateReportDto,
  @Req() req
) {
  return this.outreachService.submitReport(dto, req.user);
}

}
