import { Type } from 'class-transformer';
import { IsNotEmpty, IsNotEmptyObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { UpdateBeneficiaryDto } from './update-beneficiary.dto';

export class RequestBeneficiaryUpdateDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;

  @ValidateNested()
  @Type(() => UpdateBeneficiaryDto)
  @IsNotEmptyObject()
  changes: UpdateBeneficiaryDto;
}
