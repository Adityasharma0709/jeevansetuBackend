import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Transform } from 'class-transformer';
import {
  EconomicStatus,
  EmploymentStatus,
  Gender,
  MaritalStatus,
  BeneficiaryType,
} from '../enums/beneficiary.enum';

/** Converts DD/MM/YYYY → YYYY-MM-DD so that new Date(value) works in service. */
function parseDDMMYYYY(value: any): string {
  if (typeof value !== 'string') return value;
  const ddmmyyyy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (ddmmyyyy) {
    return `${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`;
  }
  return value; // already ISO or other format — leave untouched
}

export class CreateBeneficiaryDto {
  @IsOptional()
  @IsEnum(BeneficiaryType)
  beneficiaryType?: BeneficiaryType;

  @IsNumber()
  projectId: number;

  @IsOptional()
  @IsNumber()
  locationId?: number;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  block?: string;

  @IsOptional()
  @IsString()
  village?: string;

  @IsString()
  mobileNumber: string;

  @IsString()
  name: string;

  @IsEnum(Gender, { message: 'gender must be Male, Female, or Other' })
  gender: Gender;

  @IsOptional()
  @IsString()
  guardianName?: string;

  @Transform(({ value }) => parseDDMMYYYY(value))
  @IsDateString()
  dateOfBirth: string;

  @IsOptional()
  @IsEnum(MaritalStatus, {
    message: 'maritalStatus must be Single, Married, Widowed, or Divorced',
  })
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @Transform(({ value }) => parseDDMMYYYY(value))
  @IsString()
  dateOfMarriage?: string;

  @IsOptional()
  @IsNumber()
  womanAgeAtMarriage?: number;

  @IsOptional()
  @IsNumber()
  husbandAgeAtMarriage?: number;

  @IsOptional()
  @IsString()
  qualification?: string;

  @IsOptional()
  @IsString()
  religion?: string;

  @IsOptional()
  @IsString()
  caste?: string;

  @IsOptional()
  @IsNumber()
  monthlyIncome?: number;

  @IsOptional()
  @IsEnum(EconomicStatus, { message: 'economicStatus must be AAY, PHH, or Others' })
  economicStatus?: EconomicStatus;

  @IsOptional()
  @IsString()
  primaryIncomeSource?: string;

  @IsOptional()
  @IsEnum(EmploymentStatus, {
    message: 'employmentStatus must be Working, Not-Working, Daily-Wage-Earner, or Self-Employed',
  })
  employmentStatus?: EmploymentStatus;
}
