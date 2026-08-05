export class UserProfileDto {
  id: number;
  name: string;
  email: string;
  mobileNumber: string;
  usercode: string;
  roles: string[];
}

export class LoginResponseDto {
  accessToken: string;
  user: UserProfileDto;
}
