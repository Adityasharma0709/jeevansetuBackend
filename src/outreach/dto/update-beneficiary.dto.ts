import { Transform } from 'class-transformer';
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

const emptyToUndefined = ({ value }) =>
  value === '' || value === null ? undefined : value;

export class UpdateBeneficiaryDto {
  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(BeneficiaryType)
  beneficiaryType?: BeneficiaryType;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsNumber()
  projectId?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsNumber()
  locationId?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  state?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  district?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  block?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  village?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  name?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(Gender)
  gender?: Gender;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  guardianName?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(MaritalStatus)
  maritalStatus?: MaritalStatus;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  dateOfMarriage?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsNumber()
  womanAgeAtMarriage?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsNumber()
  husbandAgeAtMarriage?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  qualification?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  religion?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  caste?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsNumber()
  monthlyIncome?: number;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(EconomicStatus)
  economicStatus?: EconomicStatus;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  primaryIncomeSource?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsEnum(EmploymentStatus)
  employmentStatus?: EmploymentStatus;
}
