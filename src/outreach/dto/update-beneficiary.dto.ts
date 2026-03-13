import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsString
} from 'class-validator';

const emptyToUndefined = ({ value }) =>
  value === '' || value === null ? undefined : value;

export class UpdateBeneficiaryDto {
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
  mobileNumber?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  name?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  gender?: string;

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
  @IsString()
  maritalStatus?: string;

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
  @IsString()
  economicStatus?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  primaryIncomeSource?: string;

  @IsOptional()
  @Transform(emptyToUndefined)
  @IsString()
  employmentStatus?: string;
}
