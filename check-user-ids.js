const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  
  try {
    const users = await prisma.user.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        numericId: true,
        email: true,
        displayName: true,
        createdAt: true,
      }
    });
    
    console.log('\n📊 آخر 10 مستخدمين:');
    console.log('='.repeat(80));
    users.forEach(u => {
      console.log(`ID: ${u.id.slice(0,8)}... | numericId: ${u.numericId} | email: ${u.email} | name: ${u.displayName}`);
    });
    console.log('='.repeat(80));
    
    // التحقق من sequence
    const seqResult = await prisma.$queryRawUnsafe(`
      SELECT last_value, is_called FROM "User_numericId_seq"
    `);
    console.log('\n📊 قيمة sequence المستخدمين:', seqResult);
    
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
