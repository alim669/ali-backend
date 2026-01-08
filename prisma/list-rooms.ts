import { PrismaClient } from '@prisma/client';

async function listRooms() {
  const prisma = new PrismaClient();
  const rooms = await prisma.room.findMany({
    select: { id: true, name: true }
  });
  console.log(JSON.stringify(rooms, null, 2));
  await prisma.$disconnect();
}

listRooms();
