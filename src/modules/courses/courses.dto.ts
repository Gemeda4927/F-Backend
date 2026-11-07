import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
export class CourseDto {
  @IsString() @MinLength(3) @MaxLength(160) title!: string;
  @IsString() @MinLength(20) @MaxLength(20000) description!: string;
  @IsString() @MinLength(2) @MaxLength(80) category!: string;
  @IsInt() @Min(0) @Max(100000000) price_minor!: number;
  @IsIn(['ETB', 'USD']) currency!: string;
  @IsBoolean() published!: boolean;
  @IsOptional() @IsIn(['PUBLIC', 'PRIVATE', 'UNLISTED']) visibility?:
    'PUBLIC' | 'PRIVATE' | 'UNLISTED';
}
