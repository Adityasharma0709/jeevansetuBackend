import { Type } from 'class-transformer';
import { IsNotEmptyObject, ValidateNested } from 'class-validator';
import { UpdateBeneficiaryDto } from './update-beneficiary.dto';

export class RequestBeneficiaryUpdateDto {
  @ValidateNested()
  @Type(() => UpdateBeneficiaryDto)
  @IsNotEmptyObject()
  changes: UpdateBeneficiaryDto;
}
