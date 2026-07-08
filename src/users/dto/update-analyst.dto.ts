import { IsOptional, IsString, IsIn, IsEmail, MinLength } from 'class-validator';

export class UpdateAnalystDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;

  @IsOptional()
  @IsString()
  @MinLength(6)
  password?: string;
}
