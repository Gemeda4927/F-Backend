import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
export class LoginDto {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(1) @MaxLength(72) password!: string;
}
export class RegisterDto extends LoginDto {
  @MinLength(12) declare password: string;
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
}
export class ForgotDto {
  @IsEmail() @MaxLength(254) email!: string;
}
export class ResetDto {
  @IsString() @MinLength(40) @MaxLength(200) token!: string;
  @IsString() @MinLength(12) @MaxLength(72) password!: string;
}
export class ProfileDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
}
