import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class ChapterDto {
  @IsString() @MinLength(2) @MaxLength(120) title!: string;
}

export class LayoutChapterDto {
  @IsUUID() id!: string;
  @IsArray() @ArrayMaxSize(1000) @IsUUID('all', { each: true }) lesson_ids!: string[];
}

export class CurriculumDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => LayoutChapterDto)
  chapters!: LayoutChapterDto[];
}

export class CreateLessonDto {
  @IsUUID() chapter_id!: string;
  @IsString() @MinLength(2) @MaxLength(160) title!: string;
  @IsIn(['TEXT', 'VIDEO', 'PDF', 'QUIZ']) kind!: string;
}

/** Draft questions may be incomplete; completeness is checked when publishing. */
export class DraftQuestionDto {
  @IsString() @MaxLength(1000) question!: string;
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(1000, { each: true })
  options!: string[];
  @IsInt() @Min(0) @Max(5) correctIndex!: number;
  @IsOptional() @IsString() @MaxLength(2000) explanation?: string;
}

export class LessonDraftDto {
  @IsInt() @Min(1) expected_revision!: number;
  @IsString() @MaxLength(160) title!: string;
  @IsIn(['TEXT', 'VIDEO', 'PDF', 'QUIZ']) kind!: string;
  @IsBoolean() preview!: boolean;
  @IsBoolean() practice!: boolean;
  @IsString() @MaxLength(100000) content!: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DraftQuestionDto)
  quiz?: DraftQuestionDto[];
}

export class PublishCourseDto {
  @IsBoolean() published!: boolean;
}

export class PublishChangesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(1000)
  @IsUUID('all', { each: true })
  lesson_ids?: string[];
}
