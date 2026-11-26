import { IsBooleanString, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, IsArray, ValidateNested, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class AssignmentDto {
  @IsUUID() course_id!: string;
  @IsString() @MinLength(3) @MaxLength(180) title!: string;
  @IsOptional() @IsString() @MaxLength(180) university?: string;
  @IsOptional() @IsString() @MaxLength(180) department?: string;
  @IsOptional() @IsString() @MaxLength(180) program?: string;
  @IsOptional() @IsString() @MaxLength(180) chapter?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsIn(['QUESTIONS_ONLY', 'QUESTIONS_WITH_SOLUTIONS']) assignment_type!: string;
  @IsIn(['FREE', 'PREMIUM']) access_type!: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) total_pages?: number;
  @IsOptional() @IsIn(['DOCUMENT', 'PRACTICAL_TASK']) task_mode?: string;
  @IsOptional() @IsString() @MaxLength(40) difficulty?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) max_marks?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) passing_marks?: number;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsIn(['NO_LATE', 'ACCEPT_LATE', 'PENALTY']) late_policy?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) max_attempts?: number;
  @IsOptional() @IsString() @MaxLength(50000) instructions_markdown?: string;
}

export class AssignmentUpdateDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(180) title?: string;
  @IsOptional() @IsString() @MaxLength(180) university?: string;
  @IsOptional() @IsString() @MaxLength(180) department?: string;
  @IsOptional() @IsString() @MaxLength(180) program?: string;
  @IsOptional() @IsString() @MaxLength(180) chapter?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsIn(['QUESTIONS_ONLY', 'QUESTIONS_WITH_SOLUTIONS']) assignment_type?: string;
  @IsOptional() @IsIn(['FREE', 'PREMIUM']) access_type?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1000) total_pages?: number;
  @IsOptional() @IsIn(['DOCUMENT', 'PRACTICAL_TASK']) task_mode?: string;
  @IsOptional() @IsString() @MaxLength(40) difficulty?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100000) max_marks?: number;
  @IsOptional() @IsInt() @Min(1) @Max(100000) passing_marks?: number;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsIn(['NO_LATE', 'ACCEPT_LATE', 'PENALTY']) late_policy?: string;
  @IsOptional() @IsInt() @Min(1) @Max(20) max_attempts?: number;
  @IsOptional() @IsString() @MaxLength(50000) instructions_markdown?: string;
}

export class TaskSubmissionDto {
  @IsUUID() assignment_id!: string;
  @IsOptional() @IsString() @MaxLength(100000) answer_markdown?: string;
  @IsOptional() @IsBooleanString() final?: string;
}

export class EvaluationDto {
  @IsIn(['DRAFT', 'APPROVED', 'NEEDS_REVISION', 'REJECTED']) decision!: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) total_score?: number;
  @IsOptional() @IsString() @MaxLength(5000) feedback?: string;
  @IsOptional() @IsString() @MaxLength(50000) rubric_scores?: string;
  @IsOptional() publish?: boolean;
}

export class PublishDto {
  @IsBooleanString() published!: string;
}
