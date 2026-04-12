import { IsString, IsOptional, Length } from 'class-validator';

export class CreateProjectDto {
  @IsOptional()
  @IsString()
  @Length(4, 4)
  projectCode?: string;

  @IsString()
  @Length(1, 50)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
