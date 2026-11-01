import { Type, Transform } from 'class-transformer';
import { IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, Matches } from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
export class PageDto {
  @ApiPropertyOptional({ default: 1 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional({ default: 10 }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 10;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) search = '';
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] }) @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED']) status?: string;
  @ApiPropertyOptional({ enum: ['name', 'email', 'created_at'] }) @IsOptional() @IsIn(['name', 'email', 'created_at']) sort = 'created_at';
  @ApiPropertyOptional({ enum: ['asc', 'desc'] }) @IsOptional() @IsIn(['asc', 'desc']) direction: 'asc' | 'desc' = 'desc';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) @Matches(/^[A-Z_]*$/) action?: string;
}
export class StudentProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value) @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) @Matches(/^[+\d ()-]*$/) phone?: string;
  @ApiProperty() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value) @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class StudentReasonDto {
  @ApiProperty() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value) @IsString() @MinLength(5) @MaxLength(500) reason!: string;
}
export class StudentStatusDto extends StudentReasonDto {
  @ApiProperty({ enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] }) @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED']) status!: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED';
}
export class StudentAccessDto extends StudentReasonDto {
  @ApiProperty() @IsUUID() course_id!: string;
  @ApiProperty({ enum: ['GRANT', 'REVOKE'] }) @IsIn(['GRANT', 'REVOKE']) operation!: 'GRANT' | 'REVOKE';
}
