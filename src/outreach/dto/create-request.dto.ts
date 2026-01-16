import { IsNotEmpty, IsString } from 'class-validator';

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  type: string;   // UPDATE_PROFILE, UPDATE_BENEFICIARY

  data: any;      // dynamic payload
}
