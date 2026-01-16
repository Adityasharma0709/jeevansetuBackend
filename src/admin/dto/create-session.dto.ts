// src/admin/dto/create-session.dto.ts
import { IsDateString, IsInt, IsString } from 'class-validator';

export class CreateSessionDto {
  @IsInt()
  activityId: number;

  @IsString()
  name: string;

  @IsDateString()
  sessionDate: string;
}
