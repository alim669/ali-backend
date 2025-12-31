const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const userId = 'bcbed248-159e-46d3-9f30-9a95ce700b11';
  
  // تحديث دور المستخدم إلى ADMIN
  await prisma.user.update({
    where: { id: userId },
    data: { role: 'ADMIN' }
  });
  console.log('✅ Updated user role to ADMIN');
  
  // إضافة نقاط للمحفظة
  const wallet = await prisma.wallet.upsert({
    where: { userId: userId },
    update: { 
      balance: 1000000,
      diamonds: 10000 
    },
    create: {
      userId: userId,
      balance: 1000000,
      diamonds: 10000
    }
  });
  
  console.log('✅ Wallet updated:', wallet);
  console.log(`   Balance (Coins): ${wallet.balance}`);
  console.log(`   Diamonds: ${wallet.diamonds}`);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
