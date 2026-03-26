import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches } from 'class-validator';

export class CreateLocationDto {
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(/^LC[0-9]{2,}$/i, {
    message: 'Location code must be like LC01 (minimum length 4)',
  })
  locationCode?: string;

  @IsString()
  state: string;

  @IsString()
  district: string;

  @IsString()
  block: string;

  @IsString()
  village: string;
}
