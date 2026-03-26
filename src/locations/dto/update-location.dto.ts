import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsIn, IsInt, Matches } from 'class-validator';

export class UpdateLocationDto {

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(/^LC[0-9]{2,}$/i, {
    message: 'Location code must be like LC01 (minimum length 4)',
  })
  locationCode?: string;

  @IsOptional()
  @IsString()
  state?: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  block?: string;

  @IsOptional()
  @IsString()
  village?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}
