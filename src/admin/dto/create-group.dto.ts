// src/admin/dto/create-group.dto.ts
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateGroupDto {
  @IsString()
  name: string;

  @IsInt()
  @Min(0)
  minAge: number;

  @IsInt()
  @Min(0)
  maxAge: number;

  @IsOptional()
  @IsInt()
  activityId?: number;
}
