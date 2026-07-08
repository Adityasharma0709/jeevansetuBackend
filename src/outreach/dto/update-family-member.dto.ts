import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { Gender } from '../enums/beneficiary.enum';

/** Converts DD/MM/YYYY → YYYY-MM-DD so that new Date(value) works in service. */
function parseDDMMYYYY(value: any): string {
  if (typeof value !== 'string') return value;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return value;
}

export class UpdateFamilyMemberDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  relationship?: string;

  @IsOptional()
  @Transform(({ value }) => parseDDMMYYYY(value))
  @IsString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(Gender, { message: 'gender must be Male, Female, or Other' })
  gender?: Gender;

  @IsOptional()
  @IsString()
  schoolingStatus?: string;

  @IsOptional()
  @IsString()
  employmentStatus?: string;

  @IsOptional()
  @IsString()
  qualification?: string;
}
