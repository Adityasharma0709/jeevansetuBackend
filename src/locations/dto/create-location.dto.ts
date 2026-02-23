import { IsInt, IsOptional, IsString, Matches } from 'class-validator';

export class CreateLocationDto {
  @IsOptional()
  @IsInt()
  projectId?: number;

  @Matches(/^[A-Z]{2}[0-9]{2}[0-9]{4}$/, {
    message: 'Location code must be AA010001 format',
  })
  locationCode: string;

  @IsString()
  state: string;

  @IsString()
  district: string;

  @IsString()
  block: string;

  @IsString()
  village: string;
}
