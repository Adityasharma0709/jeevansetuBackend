import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(4, 4)
  projectCode?: string;

  @IsOptional()
  @IsString()
  @Length(1, 50)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: string;
}
