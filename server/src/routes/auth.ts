import { Router } from 'express';
import { z } from 'zod';
import { loginUser, registerUser, requireAuth } from '../auth.js';
import { asyncHandler, parse } from '../http.js';

const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email').max(254));

const registerSchema = z.object({
  email,
  name: z.string().trim().min(1, 'Name is required').max(60),
  // bcrypt only uses the first 72 bytes
  password: z.string().min(8, 'Password must be at least 8 characters').max(72),
});
const loginSchema = z.object({ email, password: z.string().min(1).max(72) });

export const authRouter = Router();

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { email, name, password } = parse(registerSchema, req.body);
    res.status(201).json(await registerUser(email, name, password));
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    res.json(await loginUser(email, password));
  })
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});
