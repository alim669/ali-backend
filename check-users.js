// سكريبت للتحقق من المستخدمين في قاعدة البيانات
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('================================');
  console.log('🔍 فحص قاعدة بيانات Ali (PostgreSQL)');
  console.log('================================\n');

  // عدد المستخدمين
  const userCount = await prisma.user.count();
  console.log(`📊 إجمالي المستخدمين: ${userCount}\n`);

  // آخر المستخدمين المسجلين
  const users = await prisma.user.findMany({
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      role: true,
      status: true,
      authProvider: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  console.log('👥 آخر المستخدمين المسجلين:');
  console.log('─'.repeat(100));
  
  if (users.length === 0) {
    console.log('❌ لا يوجد مستخدمين مسجلين!');
  } else {
    users.forEach((user, index) => {
      console.log(`\n${index + 1}. ${user.displayName} (@${user.username})`);
      console.log(`   📧 Email: ${user.email}`);
      console.log(`   🔐 Provider: ${user.authProvider}`);
      console.log(`   👤 Role: ${user.role}`);
      console.log(`   📍 Status: ${user.status}`);
      console.log(`   📅 Created: ${user.createdAt}`);
      console.log(`   🕐 Last Login: ${user.lastLoginAt || 'Never'}`);
    });
  }

  // عدد الغرف
  const roomCount = await prisma.room.count().catch(() => 0);
  console.log(`\n\n🏠 إجمالي الغرف: ${roomCount}`);

  // عدد الرسائل
  const messageCount = await prisma.message.count().catch(() => 0);
  console.log(`💬 إجمالي الرسائل: ${messageCount}`);

  // عدد RefreshTokens (الجلسات النشطة)
  const tokenCount = await prisma.refreshToken.count().catch(() => 0);
  console.log(`🔑 الجلسات النشطة (Refresh Tokens): ${tokenCount}`);

  // آخر تسجيلات الدخول
  const recentLogins = await prisma.user.findMany({
    where: { lastLoginAt: { not: null } },
    select: {
      username: true,
      email: true,
      lastLoginAt: true,
      lastLoginIp: true,
    },
    orderBy: { lastLoginAt: 'desc' },
    take: 10,
  });

  console.log('\n\n🕐 آخر تسجيلات الدخول:');
  console.log('─'.repeat(80));
  
  if (recentLogins.length === 0) {
    console.log('❌ لا يوجد تسجيلات دخول!');
  } else {
    recentLogins.forEach((user, index) => {
      console.log(`${index + 1}. @${user.username} - ${user.lastLoginAt} (IP: ${user.lastLoginIp || 'N/A'})`);
    });
  }

  console.log('\n================================');
  console.log('✅ انتهى الفحص');
  console.log('================================');
}

main()
  .catch((e) => {
    console.error('❌ خطأ:', e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
