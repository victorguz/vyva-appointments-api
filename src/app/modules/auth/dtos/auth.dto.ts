import {
  IsEmail,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  maxEmailLength,
  maxNameLength,
} from 'src/app/core/constants/generic.constants';

export class AuthRequestDto {
  @IsString()
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsNumber()
  @IsOptional()
  idCompany: number;
}

export class RefreshTokenRequest {
  @IsString()
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  @IsNumber()
  idCompany: number;
}

export class AuthUser {
  sub: string;
  email: string;
  role: string;
  idCompany?: number;
  agencyId?: number;
}

export class GoogleSignInDto {
  @ApiProperty({
    description: 'Google ID token',
    example: 'eyJhbGciOiJSUzI1NiIsImtpZCI6IjFiZDY4NWY1ZThmN...',
  })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class AuthCreateUserDto {
  @ApiProperty({
    description: 'Name of the user',
    example: 'John Doe',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(maxNameLength)
  name: string;

  @ApiProperty({
    description: 'Email of the user',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(maxEmailLength)
  email: string;

  @ApiProperty({
    description: 'Password of the user',
    example: 'password123',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(maxEmailLength, { message: 'MS030' })
  password: string;
}

export class AuthLoginDto {
  @ApiProperty({
    description: 'Email of the user',
    example: 'john.doe@example.com',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    description: 'Password of the user',
    example: 'password123',
  })
  @IsString()
  @IsNotEmpty()
  password: string;
}

export class AuthUpdateUserDto {
  @ApiProperty({
    description: 'First name of the user',
    example: 'John',
    required: false,
  })
  @IsString()
  @IsOptional()
  firstName?: string;

  @ApiProperty({
    description: 'Last name of the user',
    example: 'Doe',
    required: false,
  })
  @IsString()
  @IsOptional()
  lastName?: string;

  @ApiProperty({
    description: 'Email of the user',
    example: 'john.doe@example.com',
    required: false,
  })
  @IsEmail()
  @IsOptional()
  email?: string;

  @ApiProperty({
    description: 'Password of the user',
    example: 'password123',
    required: false,
  })
  @IsString()
  @IsOptional()
  password?: string;

  @ApiProperty({
    description: 'Document type of the user',
    example: 'DNI',
    required: false,
  })
  @IsString()
  @IsOptional()
  documentType?: string;

  @ApiProperty({
    description: 'Document number of the user',
    example: '12345678',
    required: false,
  })
  @IsString()
  @IsOptional()
  documentNumber?: string;

  @ApiProperty({
    description: 'Phone number of the user',
    example: '+1234567890',
    required: false,
  })
  @IsString()
  @IsOptional()
  phone?: string;
}
