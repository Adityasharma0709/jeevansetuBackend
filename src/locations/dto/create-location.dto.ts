import { IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateBlockDto {
  @IsInt()
  @IsNotEmpty()
  districtId: number;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateVillageDto {
  @IsInt()
  @IsNotEmpty()
  blockId: number;

  @IsString()
  @IsNotEmpty()
  name: string;
}

export class CreateLocationDto {
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  stateId?: number;

  @IsOptional()
  @IsInt()
  districtId?: number;

  @IsOptional()
  @IsInt()
  blockId?: number;

  @IsOptional()
  @IsInt()
  villageId?: number;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  locationCode?: string;

  @IsOptional()
  @IsString()
  awcName?: string;

  @IsOptional()
  @IsString()
  block?: any;

  @IsOptional()
  @IsString()
  village?: any;
}
