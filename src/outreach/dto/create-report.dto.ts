import { IsInt, IsNotEmpty, IsOptional } from 'class-validator';

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
  reportData: any;   // dynamic form data
}
