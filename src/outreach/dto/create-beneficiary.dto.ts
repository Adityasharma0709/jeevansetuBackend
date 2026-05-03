import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  EconomicStatus,
  EmploymentStatus,
  Gender,
  MaritalStatus,
  BeneficiaryType,
} from '../enums/beneficiary.enum';

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

  @IsDateString()
  dateOfBirth: string;

  @IsOptional()
  @IsEnum(MaritalStatus, {
    message: 'maritalStatus must be Single, Married, Widowed, or Divorced',
  })
  maritalStatus?: MaritalStatus;

  @IsOptional()
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
  @IsEnum(EconomicStatus, { message: 'economicStatus must be APL or BPL' })
  economicStatus?: EconomicStatus;

  @IsOptional()
  @IsString()
  primaryIncomeSource?: string;

  @IsOptional()
  @IsEnum(EmploymentStatus, {
    message: 'employmentStatus must be Employed, Unemployed, Self-Employed, or Student',
  })
  employmentStatus?: EmploymentStatus;
}
