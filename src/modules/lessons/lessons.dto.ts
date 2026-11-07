import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
export class QuestionDto {
  @IsOptional() @IsString() @MaxLength(2000) explanation?: string;
  @IsString() @MinLength(3) @MaxLength(1000) question!: string;
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(6)
  @IsString({ each: true })
  options!: string[];
  @IsInt() @Min(0) @Max(5) correctIndex!: number;
}
export class LessonDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(120) chapter?: string;
  @IsOptional() @IsBoolean() practice?: boolean;
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsInt() @Min(0) @Max(10000) position!: number;
  @IsIn(['TEXT', 'VIDEO', 'PDF', 'QUIZ']) kind!: string;
  @IsBoolean() preview!: boolean;
  @IsString() @MaxLength(100000) content!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  quiz?: QuestionDto[];
}
export class QuizSubmissionDto {
  @IsArray() @ArrayMaxSize(100) @IsInt({ each: true }) answers!: number[];
}
