import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    where: { email: { contains: 'test' } },
    take: 10
  });
  
  console.log('المستخدمين:');
  users.forEach((u: any) => console.log(`- ${u.email} (${u.username})`));
  
  await prisma.$disconnect();
}

main();
