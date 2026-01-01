const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // إضافة 1000000 عملة لجميع المحفظات
  const result = await prisma.wallet.updateMany({
    data: {
      balance: 1000000,
      diamonds: 10000,
    }
  });
  
  console.log(`✅ تم تحديث ${result.count} محفظة بـ 1,000,000 عملة و 10,000 ماسة`);
  
  // عرض النتيجة
  const wallets = await prisma.wallet.findMany({
    include: { user: { select: { email: true, username: true } } }
  });
  
  console.log('\nالمحفظات:');
  wallets.forEach(w => {
    console.log(`- ${w.user.email} (${w.user.username}): ${w.balance} coins, ${w.diamonds} diamonds`);
  });
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
