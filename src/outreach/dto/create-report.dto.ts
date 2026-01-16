import { IsInt, IsNotEmpty } from 'class-validator';

export class CreateReportDto {
  @IsInt()
  beneficiaryId: number;

  @IsInt()
  activityId: number;

  @IsInt()
  sessionId: number;

  @IsNotEmpty()
  reportData: any;   // dynamic form data
}
