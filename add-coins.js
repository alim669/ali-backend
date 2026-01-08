const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // عرض جميع المستخدمين
  const users = await prisma.user.findMany({
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { wallet: true }
  });
  
  console.log('المستخدمون في قاعدة البيانات:');
  users.forEach(u => {
    const walletInfo = u.wallet ? `${u.wallet.balance} coins` : 'لا محفظة';
    console.log(`- ${u.email} (${u.username}) - ${walletInfo}`);
  });
}

main()
  .catch(e => console.error('❌ خطأ:', e.message))
  .finally(() => prisma.$disconnect());
