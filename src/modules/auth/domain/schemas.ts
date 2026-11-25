import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters long')
  .max(128, 'Password must be at most 128 characters long')
  .refine((val) => /[A-Z]/.test(val), 'Password must contain at least one uppercase letter')
  .refine((val) => /[a-z]/.test(val), 'Password must contain at least one lowercase letter')
  .refine((val) => /[0-9]/.test(val), 'Password must contain at least one number')
  .refine(
    (val) => /[^A-Za-z0-9]/.test(val),
    'Password must contain at least one special character',
  );

export const registerSchema = z.object({
  email: z.string().trim().email('Valid email address is required').max(255),
  password: passwordSchema,
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(150),
});

export const loginSchema = z.object({
  email: z.string().trim().email('Valid email address is required').max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
