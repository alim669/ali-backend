const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(60));
  console.log('             جلب جميع المستخدمين من قاعدة البيانات');
  console.log('='.repeat(60));

  const users = await prisma.user.findMany({
    select: {
      id: true,
      numericId: true,
      email: true,
      username: true,
      displayName: true,
      role: true,
      status: true,
      createdAt: true,
      lastLoginAt: true,
    },
    orderBy: { createdAt: 'desc' }
  });

  console.log(`\n📊 العدد الإجمالي للمستخدمين: ${users.length}\n`);

  if (users.length === 0) {
    console.log('❌ لا يوجد مستخدمين في قاعدة البيانات');
  } else {
    console.log('قائمة المستخدمين:');
    console.log('-'.repeat(60));
    
    users.forEach((user, index) => {
      console.log(`${index + 1}. 👤 ${user.displayName}`);
      console.log(`   📧 Email: ${user.email}`);
      console.log(`   🆔 Username: ${user.username}`);
      console.log(`   🎭 Role: ${user.role}`);
      console.log(`   📍 Status: ${user.status}`);
      console.log(`   📅 Created: ${user.createdAt.toISOString()}`);
      console.log(`   🔐 Last Login: ${user.lastLoginAt ? user.lastLoginAt.toISOString() : 'Never'}`);
      console.log('-'.repeat(60));
    });
  }

  // جلب إحصائيات إضافية
  const rooms = await prisma.room.count();
  const wallets = await prisma.wallet.count();
  const gifts = await prisma.gift.count();

  console.log('\n📊 إحصائيات إضافية:');
  console.log(`   🏠 الغرف: ${rooms}`);
  console.log(`   💰 المحافظ: ${wallets}`);
  console.log(`   🎁 الهدايا: ${gifts}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
