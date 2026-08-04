import { IsInt, IsOptional, IsString, IsIn } from 'class-validator';

export class CreateInstitutionDto {
  @IsInt()
  projectId: number;

  @IsInt()
  stateId: number;

  @IsInt()
  districtId: number;

  @IsString()
  block: string;

  @IsString()
  village: string;

  @IsString()
  @IsIn(['AWC', 'HEALTH_CENTER', 'SCHOOL'])
  type: 'AWC' | 'HEALTH_CENTER' | 'SCHOOL';

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  locationCode?: string;
}
