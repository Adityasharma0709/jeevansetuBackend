import { IsOptional, IsEmail, MinLength, IsString } from 'class-validator';

export class UpdateWorkerDto {

  @IsOptional()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsOptional()
  projectId?: number;

  @IsOptional()
  locationId?: number;
}
