import { IsInt, IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class LocationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  projectId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  stateId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  districtId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  blockId?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  villageId?: number;

  @IsOptional()
  @IsString()
  @IsIn(['AWC', 'SCHOOL', 'HEALTH_CENTER'])
  type?: 'AWC' | 'SCHOOL' | 'HEALTH_CENTER';

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}
