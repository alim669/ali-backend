import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface QueryBenchmark {
  name: string;
  query: () => Promise<any>;
  iterations: number;
}

async function benchmark(name: string, fn: () => Promise<any>, iterations: number = 10): Promise<number> {
  const times: number[] = [];
  
  // Warm up
  await fn();
  
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();
    times.push(end - start);
  }
  
  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);
  
  return avg;
}

async function runBenchmarks() {
  console.log('⏱️ === اختبار أداء قاعدة البيانات ===\n');

  const results: { name: string; avgTime: number; status: string }[] = [];

  // 1. User queries
  console.log('1️⃣ اختبار استعلامات المستخدمين...');
  
  const userFindById = await benchmark('Find User by ID', async () => {
    return await prisma.user.findFirst();
  });
  results.push({ name: 'البحث عن مستخدم بالـ ID', avgTime: userFindById, status: userFindById < 10 ? '✅' : userFindById < 50 ? '⚡' : '⚠️' });

  const userFindByEmail = await benchmark('Find User by Email', async () => {
    return await prisma.user.findUnique({ where: { email: 'test@example.com' } });
  });
  results.push({ name: 'البحث عن مستخدم بالإيميل', avgTime: userFindByEmail, status: userFindByEmail < 10 ? '✅' : userFindByEmail < 50 ? '⚡' : '⚠️' });

  const userWithRelations = await benchmark('User with Relations', async () => {
    return await prisma.user.findFirst({
      include: {
        wallet: true,
        roomMemberships: { take: 5 },
        giftsSent: { take: 5 },
        giftsReceived: { take: 5 },
      }
    });
  });
  results.push({ name: 'مستخدم مع العلاقات', avgTime: userWithRelations, status: userWithRelations < 20 ? '✅' : userWithRelations < 100 ? '⚡' : '⚠️' });

  // 2. Room queries
  console.log('2️⃣ اختبار استعلامات الغرف...');
  
  const roomList = await benchmark('List Rooms', async () => {
    return await prisma.room.findMany({
      take: 20,
      include: {
        owner: { select: { id: true, username: true, avatar: true } },
        _count: { select: { members: true, messages: true } }
      }
    });
  });
  results.push({ name: 'قائمة الغرف', avgTime: roomList, status: roomList < 30 ? '✅' : roomList < 100 ? '⚡' : '⚠️' });

  const roomWithMembers = await benchmark('Room with Members', async () => {
    const room = await prisma.room.findFirst();
    if (room) {
      return await prisma.roomMember.findMany({
        where: { roomId: room.id },
        include: { user: { select: { id: true, username: true, avatar: true } } }
      });
    }
    return [];
  });
  results.push({ name: 'الغرفة مع الأعضاء', avgTime: roomWithMembers, status: roomWithMembers < 30 ? '✅' : roomWithMembers < 100 ? '⚡' : '⚠️' });

  // 3. Message queries
  console.log('3️⃣ اختبار استعلامات الرسائل...');
  
  const messageList = await benchmark('List Messages', async () => {
    const room = await prisma.room.findFirst();
    if (room) {
      return await prisma.message.findMany({
        where: { roomId: room.id },
        take: 50,
        orderBy: { createdAt: 'desc' },
        include: { sender: { select: { id: true, username: true, avatar: true } } }
      });
    }
    return [];
  });
  results.push({ name: 'قائمة الرسائل', avgTime: messageList, status: messageList < 50 ? '✅' : messageList < 150 ? '⚡' : '⚠️' });

  // 4. Gift queries
  console.log('4️⃣ اختبار استعلامات الهدايا...');
  
  const giftList = await benchmark('List Gifts', async () => {
    return await prisma.gift.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' }
    });
  });
  results.push({ name: 'قائمة الهدايا', avgTime: giftList, status: giftList < 20 ? '✅' : giftList < 50 ? '⚡' : '⚠️' });

  const giftHistory = await benchmark('Gift Send History', async () => {
    const user = await prisma.user.findFirst();
    if (user) {
      return await prisma.giftSend.findMany({
        where: { OR: [{ senderId: user.id }, { receiverId: user.id }] },
        take: 20,
        orderBy: { createdAt: 'desc' },
        include: { 
          gift: true,
          sender: { select: { id: true, username: true } },
          receiver: { select: { id: true, username: true } }
        }
      });
    }
    return [];
  });
  results.push({ name: 'سجل الهدايا', avgTime: giftHistory, status: giftHistory < 30 ? '✅' : giftHistory < 100 ? '⚡' : '⚠️' });

  // 5. Wallet queries
  console.log('5️⃣ اختبار استعلامات المحفظة...');
  
  const walletQuery = await benchmark('Get Wallet', async () => {
    const user = await prisma.user.findFirst();
    if (user) {
      return await prisma.wallet.findUnique({
        where: { userId: user.id }
      });
    }
    return null;
  });
  results.push({ name: 'استعلام المحفظة', avgTime: walletQuery, status: walletQuery < 15 ? '✅' : walletQuery < 50 ? '⚡' : '⚠️' });

  // 6. Complex aggregation
  console.log('6️⃣ اختبار التجميعات المعقدة...');
  
  const userStats = await benchmark('User Statistics', async () => {
    return await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_users,
        COUNT(*) FILTER (WHERE "isVIP" = true) as vip_users,
        COUNT(*) FILTER (WHERE "status" = 'ACTIVE') as active_users
      FROM "User"
    `;
  });
  results.push({ name: 'إحصائيات المستخدمين', avgTime: userStats, status: userStats < 20 ? '✅' : userStats < 80 ? '⚡' : '⚠️' });

  const giftStats = await benchmark('Gift Statistics', async () => {
    return await prisma.$queryRaw`
      SELECT 
        COUNT(*) as total_sends,
        SUM("totalPrice") as total_value,
        AVG("totalPrice") as avg_value
      FROM "GiftSend"
    `;
  });
  results.push({ name: 'إحصائيات الهدايا', avgTime: giftStats, status: giftStats < 20 ? '✅' : giftStats < 80 ? '⚡' : '⚠️' });

  // 7. Pagination test
  console.log('7️⃣ اختبار التصفح (Pagination)...');
  
  const paginationTest = await benchmark('Cursor Pagination', async () => {
    return await prisma.user.findMany({
      take: 20,
      orderBy: { createdAt: 'desc' },
      select: { id: true, username: true, displayName: true, avatar: true, createdAt: true }
    });
  });
  results.push({ name: 'التصفح بالمؤشر', avgTime: paginationTest, status: paginationTest < 15 ? '✅' : paginationTest < 50 ? '⚡' : '⚠️' });

  // 8. Count queries
  console.log('8️⃣ اختبار العد...');
  
  const countTest = await benchmark('Count Queries', async () => {
    return await Promise.all([
      prisma.user.count(),
      prisma.room.count(),
      prisma.message.count(),
      prisma.giftSend.count()
    ]);
  });
  results.push({ name: 'استعلامات العد', avgTime: countTest, status: countTest < 30 ? '✅' : countTest < 100 ? '⚡' : '⚠️' });

  // Print results
  console.log('\n📊 === نتائج اختبار الأداء ===\n');
  console.log('   ┌─────────────────────────────────┬───────────────┬────────┐');
  console.log('   │ الاستعلام                       │ الزمن (مللي)  │ الحالة │');
  console.log('   ├─────────────────────────────────┼───────────────┼────────┤');
  
  for (const r of results) {
    const name = r.name.padEnd(31);
    const time = r.avgTime.toFixed(2).padStart(13);
    console.log(`   │ ${name} │ ${time} │   ${r.status}   │`);
  }
  
  console.log('   └─────────────────────────────────┴───────────────┴────────┘');

  // Summary
  const avgTime = results.reduce((a, b) => a + b.avgTime, 0) / results.length;
  const fastQueries = results.filter(r => r.status === '✅').length;
  const mediumQueries = results.filter(r => r.status === '⚡').length;
  const slowQueries = results.filter(r => r.status === '⚠️').length;

  console.log('\n📈 ملخص الأداء:');
  console.log(`   - متوسط زمن الاستعلام: ${avgTime.toFixed(2)} مللي ثانية`);
  console.log(`   - استعلامات سريعة (< 10-30ms): ${fastQueries}`);
  console.log(`   - استعلامات متوسطة (30-100ms): ${mediumQueries}`);
  console.log(`   - استعلامات بطيئة (> 100ms): ${slowQueries}`);

  if (slowQueries > 0) {
    console.log('\n⚠️ توصيات لتحسين الاستعلامات البطيئة:');
    console.log('   - إضافة فهارس مركبة للاستعلامات المعقدة');
    console.log('   - استخدام select بدلاً من include عند الإمكان');
    console.log('   - تقليل عدد العلاقات في الاستعلام الواحد');
    console.log('   - استخدام cursor-based pagination');
  } else {
    console.log('\n✅ أداء قاعدة البيانات ممتاز!');
  }

  console.log('\n✅ === اكتمل اختبار الأداء ===\n');

  await prisma.$disconnect();
}

runBenchmarks().catch(console.error);
