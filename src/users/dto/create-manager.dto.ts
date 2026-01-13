import { IsEmail, IsInt, IsString, MinLength } from 'class-validator';

export class CreateManagerDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @MinLength(6)
  password: string;

  @IsInt()
  projectId: number;

  @IsInt()
  locationId: number;
}
