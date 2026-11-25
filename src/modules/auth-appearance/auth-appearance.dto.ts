import { IsNumberString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class AuthAppearanceDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(120) headline?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(500) description?: string;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(160) slogan?: string;
  @IsOptional() @IsNumberString() overlay_opacity?: string;
}
