import { IsOptional, IsEmail, MinLength } from 'class-validator';

export class UpdateWorkerDto {

  @IsOptional()
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @MinLength(6)
  password?: string;

  @IsOptional()
  projectId?: number;

  @IsOptional()
  locationId?: number;
}
