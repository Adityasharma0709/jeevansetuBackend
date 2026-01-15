import { IsInt } from 'class-validator';

export class TagGroupActivityDto {
  @IsInt()
  groupId: number;

  @IsInt()
  activityId: number;
}
