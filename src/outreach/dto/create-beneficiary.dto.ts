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
} from '../enums/beneficiary.enum';

export class CreateBeneficiaryDto {
  @IsNumber()
  projectId: number;

  @IsNumber()
  locationId: number;

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

  @IsString()
  guardianName: string;

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

  @IsString()
  qualification: string;

  @IsString()
  religion: string;

  @IsString()
  caste: string;

  @IsNumber()
  monthlyIncome: number;

  @IsEnum(EconomicStatus, { message: 'economicStatus must be APL or BPL' })
  economicStatus: EconomicStatus;

  @IsString()
  primaryIncomeSource: string;

  @IsEnum(EmploymentStatus, {
    message: 'employmentStatus must be Employed, Unemployed, Self-Employed, or Student',
  })
  employmentStatus: EmploymentStatus;
}
