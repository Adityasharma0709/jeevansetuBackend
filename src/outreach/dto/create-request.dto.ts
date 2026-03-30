import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsOptional()
  data: any;
}
