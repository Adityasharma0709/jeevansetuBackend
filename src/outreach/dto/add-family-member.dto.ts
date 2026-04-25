import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { Gender } from '../enums/beneficiary.enum';

export class AddFamilyMemberDto {
  @IsString()
  name: string;

  @IsString()
  relationship: string;

  @IsDateString()
  dateOfBirth: string;

  @IsEnum(Gender, { message: 'gender must be Male, Female, or Other' })
  gender: Gender;

  /** Required when age ≤ 14 */
  @IsOptional()
  @IsString()
  schoolingStatus?: string;

  /** Required when age > 14 */
  @IsOptional()
  @IsString()
  employmentStatus?: string;
}
