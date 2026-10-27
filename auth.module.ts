import {
  Body, CanActivate, Controller, createParamDecorator, ExecutionContext, ForbiddenException,
  Global, Injectable, Module, NotFoundException, Post, SetMetadata, UnauthorizedException, UseGuards, Get,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import { IsEmail, IsOptional, IsString } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';

export interface AuthUser {
  id: string;
  role: Role;
  name: string;
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user,
);

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService, private prisma: PrismaService) {}

  sign(userId: string) {
    return this.jwt.sign({ sub: userId });
  }

  /** Shared by the HTTP guard and the Socket.IO handshake. */
  async verify(token: string | undefined): Promise<AuthUser> {
    if (!token) throw new UnauthorizedException();
    let sub: string;
    try {
      sub = (await this.jwt.verifyAsync<{ sub: string }>(token)).sub;
    } catch {
      throw new UnauthorizedException();
    }
    const user = await this.prisma.user.findUnique({ where: { id: sub } });
    if (!user) throw new UnauthorizedException();
    if (user.blockedAt) throw new ForbiddenException('Account blocked: ' + (user.blockReason ?? 'policy violation'));
    return { id: user.id, role: user.role, name: user.name };
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private auth: AuthService, private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers.authorization ?? '';
    const user = await this.auth.verify(header.replace(/^Bearer\s+/i, '') || undefined);
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && !roles.includes(user.role)) throw new ForbiddenException();
    req.user = user;
    return true;
  }
}

class DevLoginDto {
  @IsEmail() email: string;
  @IsOptional() @IsString() name?: string;
}

/**
 * Dev-only login so the app is usable before a real identity provider (Cognito/Auth0/OTP) is wired.
 */
@Controller('auth')
export class AuthController {
  constructor(private prisma: PrismaService, private auth: AuthService) {}

  @Post('dev-login')
  async devLogin(@Body() dto: DevLoginDto) {
    if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    const user = await this.prisma.user.upsert({
      where: { email: dto.email },
      update: {},
      create: { email: dto.email, name: dto.name ?? dto.email.split('@')[0] },
    });
    return { token: this.auth.sign(user.id), user };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return this.prisma.user.findUnique({ where: { id: user.id } });
  }
}

@Global()
@Module({
  imports: [
    JwtModule.register({
      secret: process.env.JWT_SECRET ?? 'dev-secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard],
  exports: [AuthService, AuthGuard, JwtModule],
})
export class AuthModule {}
