import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Gender } from '../enums/beneficiary.enum';

/** Converts DD/MM/YYYY → YYYY-MM-DD so that new Date(value) works in service. */
function parseDDMMYYYY(value: any): string {
  if (typeof value !== 'string') return value;
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }
  return value; // already ISO or other format — leave untouched
}

export class AddFamilyMemberDto {
  @IsString()
  name: string;

  @IsString()
  relationship: string;

  @Transform(({ value }) => parseDDMMYYYY(value))
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

  @IsOptional()
  @IsString()
  qualification?: string;
}
