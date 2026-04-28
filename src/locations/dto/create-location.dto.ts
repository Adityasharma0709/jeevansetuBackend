import { Transform } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  ArrayUnique,
} from 'class-validator';

export class CreateLocationDto {
  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsInt({ each: true })
  projectIds?: number[];

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  @Matches(/^LC[0-9]{2,}$/i, {
    message: 'Location code must be like LC01 (minimum length 4)',
  })
  locationCode?: string;

  @IsOptional()
  @IsString()
  awcName?: string;

  @IsString()
  state: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  block?: string;

  @IsOptional()
  @IsString()
  village?: string;
}
