import { IsInt, IsOptional } from 'class-validator';

export class AssignProjectDto {
  @IsInt()
  userId: number;

  @IsInt()
  projectId: number;

  @IsOptional()
  @IsInt()
  locationId?: number;
}
