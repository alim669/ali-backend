const { PrismaClient } = require('@prisma/client');

async function checkUser() {
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      take: 5,
      select: { id: true, email: true, role: true, username: true, numericId: true, customId: true }
    });
    console.log('Users:', JSON.stringify(users, null, 2));
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkUser();
