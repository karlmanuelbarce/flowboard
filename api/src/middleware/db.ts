// src/db.ts
import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/client.ts';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const url = process.env['DATABASE_URL'];
if (!url) throw new Error('DATABASE_URL is not set');

const adapter = new PrismaBetterSqlite3({ url });
export const prisma = new PrismaClient({ adapter });