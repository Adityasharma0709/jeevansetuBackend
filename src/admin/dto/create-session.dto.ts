// src/admin/dto/create-session.dto.ts
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateSessionDto {
  @Type(() => Number)
  @IsInt()
  activityId: number;

  @IsString()
  name: string;

  @IsOptional()
  @Type(() => Date)
  sessionDate?: Date;
}
