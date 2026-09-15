import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { Gender } from '../enums/beneficiary.enum';

/** Converts DD/MM/YYYY or DD-MM-YYYY → YYYY-MM-DD so that new Date(value) works in service. */
function parseDDMMYYYY(value: any): string {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const ddmmyyyy = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(trimmed);
  if (ddmmyyyy) {
    const day = ddmmyyyy[1].padStart(2, '0');
    const month = ddmmyyyy[2].padStart(2, '0');
    const year = ddmmyyyy[3];
    return `${year}-${month}-${day}`;
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
