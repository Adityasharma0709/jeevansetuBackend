import { IsString } from 'class-validator';

export class RejectRequestDto {
  @IsString()
  reason: string;
}
