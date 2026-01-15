import { IsOptional, IsString } from 'class-validator';

export class CreateActivityDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  description?: string;
}
