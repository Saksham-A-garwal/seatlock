import { NextFunction, Request, Response } from "express";
import { Role } from "@prisma/client";
import { AuthTokenError } from "./errors";
import { verifyAccessToken } from "./tokens";

// Named `auth`, not `user`, to avoid colliding with Passport's own `req.user`
// (which the Google OAuth callback route sets to the full Prisma User row).
declare global {
  namespace Express {
    interface Request {
      auth?: { id: number; role: Role };
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({
      error: { code: "UNAUTHORIZED", message: "Missing or invalid Authorization header" },
    });
    return;
  }

  const token = header.slice("Bearer ".length);
  try {
    const payload = verifyAccessToken(token);
    req.auth = { id: payload.sub, role: payload.role };
    next();
  } catch (error) {
    if (error instanceof AuthTokenError) {
      res.status(401).json({ error: { code: "UNAUTHORIZED", message: error.message } });
      return;
    }
    throw error;
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.auth?.role !== Role.ADMIN) {
    res.status(403).json({ error: { code: "FORBIDDEN", message: "Admin access required" } });
    return;
  }
  next();
}
