import { PrismaPg } from '@prisma/adapter-pg';
import { env } from '../config/env';
import { PrismaClient } from '../generated/prisma/client';

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
});

export type TxClient = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
export type DbClient = typeof prisma | TxClient;
