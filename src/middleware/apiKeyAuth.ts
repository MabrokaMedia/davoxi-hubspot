import { Request, Response, NextFunction } from 'express';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'] as string;
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || !key || key !== expected) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
