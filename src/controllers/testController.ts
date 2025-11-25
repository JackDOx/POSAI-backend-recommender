import { Request, Response } from 'express';
import { db } from '../db';

export async function testEndpoint(req: Request, res: Response) {
  const result = await db.query('SELECT NOW()');
  res.json({ time: result.rows[0] });
}