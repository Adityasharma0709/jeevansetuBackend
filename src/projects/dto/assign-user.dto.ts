import { IsInt } from 'class-validator';

export class AssignUserDto {
  @IsInt()
  userId: number;

  @IsInt()
  projectId: number;

  @IsInt()
  locationId: number;
}
