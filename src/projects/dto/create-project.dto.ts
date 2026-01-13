import { IsString, IsOptional, Length } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Length(4, 4)
  projectCode: string;

  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
