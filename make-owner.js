const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = 'sdad34461@gmail.com';
  
  // البحث عن المستخدم
  const user = await prisma.user.findUnique({
    where: { email: email }
  });
  
  if (!user) {
    console.log('❌ المستخدم غير موجود');
    return;
  }
  
  console.log('👤 المستخدم:', user.username, user.email);
  
  // تحديث دور المستخدم إلى SUPER_ADMIN
  await prisma.user.update({
    where: { id: user.id },
    data: { 
      role: 'SUPER_ADMIN',
      isAdmin: true,
      coins: 1000000000  // مليار نقطة
    }
  });
  console.log('✅ تم تحديث المستخدم إلى SUPER_ADMIN (المالك)');
  console.log('✅ تم إضافة 1,000,000,000 نقطة');
  
  // تحديث المحفظة
  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    update: { 
      balance: 1000000000,
      diamonds: 1000000000 
    },
    create: {
      userId: user.id,
      balance: 1000000000,
      diamonds: 1000000000
    }
  });
  
  console.log('✅ تم تحديث المحفظة');
  console.log(`   Balance: ${wallet.balance.toLocaleString()}`);
  console.log(`   Diamonds: ${wallet.diamonds.toLocaleString()}`);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
