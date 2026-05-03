import { IsEmail, IsInt, IsString, MinLength, IsOptional } from 'class-validator';

export class CreateManagerDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  usercode?: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @MinLength(6)
  password: string;

  @IsOptional()
  @IsInt()
  projectId?: number;

  @IsOptional()
  @IsInt()
  locationId?: number;

  @IsOptional()
  @IsInt()
  stateId?: number;
}
