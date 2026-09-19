import { IsInt, IsOptional, IsString, IsIn } from 'class-validator';

export class CreateInstitutionDto {
  @IsInt()
  projectId: number;

  @IsInt()
  stateId: number;

  @IsInt()
  districtId: number;

  @IsOptional()
  @IsInt()
  blockId?: number;

  @IsOptional()
  @IsString()
  block?: any;

  @IsOptional()
  @IsInt()
  villageId?: number;

  @IsOptional()
  @IsString()
  village?: any;

  @IsString()
  @IsIn(['AWC', 'HEALTH_CENTER', 'SCHOOL'])
  type: 'AWC' | 'HEALTH_CENTER' | 'SCHOOL';

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  awcName?: string;

  @IsOptional()
  @IsString()
  schoolName?: string;

  @IsOptional()
  @IsString()
  healthCenterName?: string;

  @IsOptional()
  @IsString()
  locationCode?: string;
}
