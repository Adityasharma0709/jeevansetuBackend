// src/beneficiary/dto/create-beneficiary.dto.ts
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString
} from 'class-validator';

export class CreateBeneficiaryDto {

  @IsNumber()
  projectId: number;

  @IsNumber()
  locationId: number;

  @IsString()
  mobileNumber: string;

  @IsString()
  name: string;

  @IsString()
  gender: string;

  @IsString()
  guardianName: string;

  @IsDateString()
  dateOfBirth: string;

  @IsOptional()
  @IsString()
  maritalStatus?: string;

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

  @IsString()
  economicStatus: string;

  @IsString()
  primaryIncomeSource: string;

  @IsString()
  employmentStatus: string;
}
