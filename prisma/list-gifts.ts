import { PrismaClient } from '@prisma/client';

async function listGifts() {
  const prisma = new PrismaClient();
  const gifts = await prisma.gift.findMany({
    select: { id: true, name: true, price: true }
  });
  console.log(JSON.stringify(gifts, null, 2));
  await prisma.$disconnect();
}

listGifts();
