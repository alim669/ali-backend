import { PrismaClient } from '@prisma/client';

async function checkEmails() {
  const prisma = new PrismaClient();
  
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@test.com' } },
    select: { email: true, displayName: true }
  });
  
  console.log('📧 البريد الإلكتروني للمستخدمين:');
  users.forEach(u => console.log(`  - "${u.email}" (${u.displayName})`));
  
  await prisma.$disconnect();
}

checkEmails();
