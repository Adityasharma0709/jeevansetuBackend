import { IsInt } from 'class-validator';

export class AssignProjectDto {
  @IsInt()
  userId: number;

  @IsInt()
  projectId: number;

  @IsInt()
  locationId: number;
}
