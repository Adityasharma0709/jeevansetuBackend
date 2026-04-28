import { IsInt, IsOptional, IsString, IsIn } from 'class-validator';

export class CreateLocationDto {
  @IsInt()
  projectId: number;

  @IsString()
  locationCode: string;

  @IsOptional()
  @IsString()
  awcName?: string;

  @IsInt()
  stateId: number;

  @IsOptional()
  @IsInt()
  districtId?: number;

  @IsOptional()
  @IsString()
  block?: string;

  @IsOptional()
  @IsString()
  village?: string;
}
