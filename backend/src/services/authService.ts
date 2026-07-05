import prisma from '../utils/prisma.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import { RegisterInput, LoginInput, AuthResponse, UserDTO } from '../types/auth.types';
import { EmailService } from './emailService.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('Critical Configuration Error: JWT_SECRET environment variable is missing.');
}

// 1. Define compile-time safe database return shapes using Prisma's type utilities
type DBUserWithRelations = Prisma.UserGetPayload<{
  include: { accounts: true };
}>;

/**
 * Data Transfer Object (DTO) to sanitize and transform database payloads 
 * securely before transmitting data to the client application layer.
 */
function toUserDTO(user: DBUserWithRelations): UserDTO {
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    referralRate: Number(user.referralRate),
    kycStatus: user.kycStatus,
    idDocument: user.idDocument ?? null,
    createdAt: user.createdAt,
    accounts: (user.accounts ?? []).map((acc) => ({
      id: acc.id,
      type: acc.type,
      balance: Number(acc.balance),
      currency: acc.currency,
      createdAt: acc.createdAt,
    })),
  };
}

export class AuthService {
  
  /**
   * Registers a new platform user and auto-provisions structural sub-accounts.
   */
  static async register(userData: RegisterInput): Promise<AuthResponse> {
    const { password, referrerId } = userData;
    const email = userData.email.trim().toLowerCase();

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new Error('EMAIL_ALREADY_IN_USE');
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    // Database atomic operation execution
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        ...(referrerId && { referrer: { connect: { id: referrerId } } }),
        accounts: {
          create: [
            { type: 'DEMO', balance: 10000.00 },
            { type: 'REAL', balance: 0.00 },
          ],
        },
      },
      include: { 
        accounts: true 
      },
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role }, 
      JWT_SECRET!, 
      { expiresIn: '7d' }
    );

    return { user: toUserDTO(user), token };
  }

  /**
   * Authenticates user credentials and checks for active risk mitigators.
   */
  static async login(credentials: LoginInput): Promise<AuthResponse> {
    const { email, password } = credentials;
    const emailTrimmed = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: emailTrimmed },
      include: { accounts: true }
    });

    if (!user) {
      throw new Error('INVALID_CREDENTIALS');
    }
    if (user.status === 'SUSPENDED') {
      throw new Error('ACCOUNT_SUSPENDED');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET!,
      { expiresIn: '7d' }
    );

    return { user: toUserDTO(user), token };
  }

  /**
   * Initiates the password recovery pipeline.
   * Protects against user enumeration attacks by returning a generic success response.
   */
  static async forgotPassword(email: string): Promise<{ message: string }> {
    const emailTrimmed = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({ where: { email: emailTrimmed } });

    // Mitigate enumeration vector
    if (!user) {
      return { message: 'PASSWORD_RESET_EMAIL_SENT' };
    }

    // Generate high-entropy hex token
    const resetToken = crypto.randomBytes(32).toString('hex');
    
    // Tokens expire precisely 1 hour from creation
    const tokenValidityPeriod = 60 * 60 * 1000; 
    const expiresAt = new Date(Date.now() + tokenValidityPeriod);

    // Save token state within database transaction
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        token: resetToken,
        expiresAt,
      },
    });

    // Send password reset email via EmailService
    const frontendUrl = process.env.FRONTEND_URL;
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    // Dispatch the email via EmailService
    try {
      await EmailService.sendPasswordResetEmail(user, resetLink);
    } catch (emailError) {
      // Log the error but don't crash the request context if it's a non-fatal mail block
      console.error(`[AuthService] Failed to dispatch recovery email to ${email}:`, emailError);
      // Optional: throw emailError if you want to explicitly return a 500 error to the client
    }

    return { message: 'PASSWORD_RESET_EMAIL_SENT' };
  }

  /**
   * Validates recovery token parameters and applies newly requested password hashes.
   */
  static async resetPassword(token: string, password: string): Promise<{ message: string }> {
    // Audit token lifecycle variables natively through Prisma filters
    const tokenRecord = await prisma.passwordResetToken.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!tokenRecord || tokenRecord.used || tokenRecord.expiresAt < new Date()) {
      throw new Error('INVALID_OR_EXPIRED_TOKEN');
    }

    // Hash the new credential securely
    const hashedPassword = await bcrypt.hash(password, 12);

    // Execute atomic changes across both models in a database transaction
    await prisma.$transaction([
      prisma.user.update({
        where: { id: tokenRecord.userId },
        data: { password: hashedPassword },
      }),
      prisma.passwordResetToken.update({
        where: { id: tokenRecord.id },
        data: { used: true },
      }),
    ]);

    return { message: 'PASSWORD_RESET_SUCCESSFUL' };
  }

  /**
   * Resolves an authenticated user identity and returns a clean context DTO
   */
  static async getMe(userId: string): Promise<{ user: UserDTO }> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { accounts: true },
    });

    if (!user) {
      throw new Error('USER_NOT_FOUND');
    }
    if (user.status === 'SUSPENDED') {
      throw new Error('ACCOUNT_SUSPENDED');
    }

    return { user: toUserDTO(user) };
  }
}