import { PrismaClient } from '@prisma/client';

async function checkUsers() {
  const prisma = new PrismaClient();
  
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@test.com' } },
    select: { email: true, displayName: true, wallet: true }
  });
  
  console.log(JSON.stringify(users, null, 2));
  await prisma.$disconnect();
}

checkUsers();
