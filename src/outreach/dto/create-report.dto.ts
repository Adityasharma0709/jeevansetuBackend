import { IsInt, IsNotEmpty } from 'class-validator';

export class CreateReportDto {
  @IsInt()
  beneficiaryId: number;

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
