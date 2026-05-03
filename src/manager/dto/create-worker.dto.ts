import { IsEmail, IsInt, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateWorkerDto {

  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @IsOptional()
  @IsString()
  mobile?: string;

  @IsOptional()
  @IsString()
  usercode?: string;

  @MinLength(6)
  password: string;

  @IsInt()
  projectId: number;

  @IsOptional()
  @IsInt()
  locationId?: number;

  @IsOptional()
  @IsInt()
  stateId?: number;
}
