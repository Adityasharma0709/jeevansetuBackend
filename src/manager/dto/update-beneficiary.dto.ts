import { PartialType } from '@nestjs/mapped-types';
import { CreateBeneficiaryDto } from '../../outreach/dto/create-beneficiary.dto';

export class UpdateBeneficiaryDto extends PartialType(CreateBeneficiaryDto) { }
