import { IsInt, IsNotEmpty, IsOptional, ValidateNested, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportDataDto {
  /** Screening status: 'Yes' | 'No' */
  screening?: string;

  /** Screening test results (present when screening = 'Yes') */
  screeningDetails?: Record<string, any>;

  /**
   * Pregnancy status — only applicable for female beneficiaries aged 14+.
   */
  @IsOptional()
  @IsIn(['Yes', 'No', 'Currently Pregnant', 'Still Birth', 'Miscarriage/Aborted', 'Baby Delivered'])
  pregnancyStatus?: string;

  /**
   * Pregnancy outcome — only applicable if previously pregnant.
   */
  @IsOptional()
  @IsIn(['Still Birth', 'Miscarriage/Aborted', 'Baby Delivered'])
  pregnancyOutcome?: string;

  /**
   * Expected Date of Delivery in DD/MM/YYYY format.
   */
  @IsOptional()
  @IsString()
  edd?: string;

  /**
   * Last Menstrual Period date in DD/MM/YYYY format.
   * Present only when pregnancyStatus = 'Currently Pregnant'.
   */
  @IsOptional()
  @IsString()
  lmpDate?: string;

  /**
   * Nutritional status for children aged 5 years and under.
   * Values: 'SAM' | 'MAM' | 'NONE'
   */
  @IsOptional()
  @IsIn(['SAM', 'MAM', 'NONE'])
  samMamStatus?: string;
}

export class CreateReportDto {
  @IsInt()
  beneficiaryId: number;

  @IsInt()
  @IsOptional()
  childId?: number;

  @IsInt()
  activityId: number;

  @IsInt()
  @IsNotEmpty()
  sessionId: number;

  @IsNotEmpty()
  sessionDate: string;

  @IsNotEmpty()
  reportData: ReportDataDto | any; // dynamic form data; ReportDataDto documents the known structure
}
