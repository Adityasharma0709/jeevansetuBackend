import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateAnalystDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsOptional()
  @IsString()
  mobileNumber?: string;

  @MinLength(6)
  password: string;
}
