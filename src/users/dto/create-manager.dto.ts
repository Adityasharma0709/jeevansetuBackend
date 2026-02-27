import { IsEmail, IsInt, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateManagerDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @MinLength(6)
  password: string;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  locationId?: number;
}
