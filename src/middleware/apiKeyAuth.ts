import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const key = req.headers['x-api-key'] as string;
  const expected = process.env.INTERNAL_API_KEY;
  if (!expected || !key) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  // Use timingSafeEqual to prevent timing-based side-channel attacks
  const keyBuf = Buffer.from(key);
  const expectedBuf = Buffer.from(expected);
  const match =
    keyBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(keyBuf, expectedBuf);
  if (!match) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
