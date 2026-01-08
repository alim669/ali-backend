const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ 
    where: { email: 'sdad34461@gmail.com' } 
  });
  
  if (!user) { 
    console.log('المستخدم غير موجود'); 
    return; 
  }
  
  const wallet = await prisma.wallet.upsert({ 
    where: { userId: user.id }, 
    update: { balance: { increment: 10000000 } }, 
    create: { userId: user.id, balance: 10000000, diamonds: 0 } 
  });
  
  console.log('✅ تم إضافة 10,000,000 عملة لـ ' + user.email);
  console.log('الرصيد الجديد: ' + wallet.balance);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
