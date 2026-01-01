const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // جلب جميع المستخدمين
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      wallet: true,
    }
  });
  
  console.log('المستخدمين:');
  users.forEach(user => {
    console.log(`- ID: ${user.id}`);
    console.log(`  Email: ${user.email}`);
    console.log(`  Username: ${user.username}`);
    console.log(`  Wallet: ${user.wallet ? `${user.wallet.balance} coins, ${user.wallet.diamonds} diamonds` : 'لا توجد'}`);
    console.log('');
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
