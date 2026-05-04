import { IsInt, IsNotEmpty, IsOptional, ValidateNested, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportDataDto {
  /** Screening status: 'Yes' | 'No' */
  screening?: string;

  /** Screening test results (present when screening = 'Yes') */
  screeningDetails?: Record<string, any>;

  /**
   * Pregnancy status — only applicable for female beneficiaries aged 14+.
   * Only allowed value: 'Yes' (optional field).
   */
  @IsOptional()
  @IsIn(['Yes'])
  pregnancyStatus?: string;

  /**
   * Last Menstrual Period date in DD/MM/YYYY format.
   * Present only when pregnancyStatus = 'Yes'.
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
