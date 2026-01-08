import { PrismaClient } from '@prisma/client';

async function addBalance() {
  const prisma = new PrismaClient();
  
  console.log('💰 إضافة رصيد للمستخدمين التجريبيين...\n');
  
  const testEmails = [
    'ahmed2@test.com',
    'sara2@test.com', 
    'ali2@test.com',
    'fatima2@test.com',
    'nour2@test.com',
    'test123@test.com',
  ];
  
  for (const email of testEmails) {
    const user = await prisma.user.findUnique({
      where: { email },
      include: { wallet: true }
    });
    
    if (user) {
      if (user.wallet) {
        // تحديث الرصيد
        await prisma.wallet.update({
          where: { userId: user.id },
          data: { balance: 100000, diamonds: 1000 }
        });
      } else {
        // إنشاء محفظة
        await prisma.wallet.create({
          data: {
            userId: user.id,
            balance: 100000,
            diamonds: 1000,
          }
        });
      }
      console.log(`✅ ${user.displayName} (${email}) - 100,000 نقطة`);
    }
  }
  
  await prisma.$disconnect();
  console.log('\n✨ تم إضافة الرصيد بنجاح!');
}

addBalance().catch(console.error);
