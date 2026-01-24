/**
 * Script للتحقق من قيم numericId في الغرف
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔍 التحقق من numericId في الغرف...\n');
  
  const rooms = await prisma.room.findMany({
    select: {
      id: true,
      numericId: true,
      name: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });
  
  console.log('آخر 10 غرف:');
  console.log('─'.repeat(80));
  
  for (const room of rooms) {
    console.log(`ID: ${room.id}`);
    console.log(`numericId: ${room.numericId}`);
    console.log(`Name: ${room.name}`);
    console.log(`Created: ${room.createdAt}`);
    console.log('─'.repeat(80));
  }
  
  // التحقق من الـ sequence
  const seqResult = await prisma.$queryRaw`SELECT last_value FROM "Room_numericId_seq"` as any[];
  console.log('\n📊 قيمة الـ sequence الحالية:', seqResult[0]?.last_value);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
