import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  userId?: string;
  user?: any;
}

export async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { userId: string; role?: string };
    // Attach userId from the verified JWT — no DB lookup needed here.
    // Routes that need the full user object should fetch it themselves.
    req.userId = payload.userId;
    req.user = { id: payload.userId, role: payload.role };
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
}