import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: [
    { level: 'query', emit: 'event' },
  ],
});

async function analyzeLatency() {
  console.log('🔍 === تحليل زمن الاستجابة ===\n');

  // 1. Test raw connection latency
  console.log('1️⃣ قياس زمن الاتصال...');
  const pingTimes: number[] = [];
  
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    await prisma.$queryRaw`SELECT 1`;
    const end = performance.now();
    pingTimes.push(end - start);
  }
  
  const avgPing = pingTimes.reduce((a, b) => a + b, 0) / pingTimes.length;
  console.log(`   📡 متوسط زمن الـ Ping: ${avgPing.toFixed(2)} مللي ثانية`);
  console.log(`   📡 أقل زمن: ${Math.min(...pingTimes).toFixed(2)} مللي ثانية`);
  console.log(`   📡 أعلى زمن: ${Math.max(...pingTimes).toFixed(2)} مللي ثانية`);

  if (avgPing > 100) {
    console.log('\n   ⚠️ زمن الاتصال عالي! السبب المحتمل:');
    console.log('      - السيرفر بعيد جغرافياً (ألمانيا - Hetzner)');
    console.log('      - لا يوجد connection pooling');
    console.log('      - الاتصال يتم عبر الإنترنت وليس محلياً');
  }

  // 2. Check if pooling is enabled
  console.log('\n2️⃣ فحص إعدادات الاتصال...');
  const poolInfo = await prisma.$queryRaw<any[]>`
    SELECT 
      setting as max_connections 
    FROM pg_settings 
    WHERE name = 'max_connections'
  `;
  console.log(`   📊 الحد الأقصى للاتصالات: ${poolInfo[0].max_connections}`);

  const activeConns = await prisma.$queryRaw<any[]>`
    SELECT count(*) as count FROM pg_stat_activity
  `;
  console.log(`   📊 الاتصالات النشطة: ${activeConns[0].count}`);

  // 3. Network latency simulation
  console.log('\n3️⃣ تحليل مكونات البطء...');
  
  // Simple query
  const start1 = performance.now();
  await prisma.user.count();
  const simpleQueryTime = performance.now() - start1;
  
  // Complex query
  const start2 = performance.now();
  await prisma.user.findMany({
    take: 10,
    include: {
      wallet: true,
      roomMemberships: { take: 3 },
      giftsSent: { take: 3 },
    }
  });
  const complexQueryTime = performance.now() - start2;

  console.log(`   ⚡ استعلام بسيط: ${simpleQueryTime.toFixed(2)} ms`);
  console.log(`   ⚡ استعلام معقد: ${complexQueryTime.toFixed(2)} ms`);
  console.log(`   ⚡ الفرق: ${(complexQueryTime - simpleQueryTime).toFixed(2)} ms`);

  // Calculate overhead
  const networkOverhead = avgPing;
  const queryOverhead = simpleQueryTime - avgPing;
  
  console.log('\n4️⃣ تقسيم الوقت:');
  console.log(`   🌐 زمن الشبكة (Network Latency): ~${networkOverhead.toFixed(0)} ms`);
  console.log(`   💾 زمن المعالجة (Processing): ~${Math.max(0, queryOverhead).toFixed(0)} ms`);

  console.log('\n5️⃣ التوصيات:');
  
  if (avgPing > 200) {
    console.log('   🔴 مشكلة كبيرة: زمن الشبكة عالي جداً');
    console.log('');
    console.log('   الحلول المقترحة:');
    console.log('   ┌────────────────────────────────────────────────────────────────┐');
    console.log('   │ 1. استخدام PgBouncer للـ Connection Pooling                    │');
    console.log('   │    - يقلل وقت إنشاء الاتصالات                                 │');
    console.log('   │    - يعيد استخدام الاتصالات الموجودة                          │');
    console.log('   │                                                                │');
    console.log('   │ 2. استخدام Prisma Accelerate                                  │');
    console.log('   │    - خدمة من Prisma للتخزين المؤقت                           │');
    console.log('   │    - تقلل الاستعلامات بشكل كبير                              │');
    console.log('   │                                                                │');
    console.log('   │ 3. تفعيل Query Caching في Redis                               │');
    console.log('   │    - تخزين نتائج الاستعلامات المتكررة                        │');
    console.log('   │    - تقليل الضغط على قاعدة البيانات                          │');
    console.log('   │                                                                │');
    console.log('   │ 4. نقل التطبيق قرب السيرفر                                    │');
    console.log('   │    - إذا كان السيرفر في ألمانيا، شغل الـ Backend هناك         │');
    console.log('   └────────────────────────────────────────────────────────────────┘');
  }

  console.log('\n✅ === اكتمل التحليل ===\n');

  await prisma.$disconnect();
}

analyzeLatency().catch(console.error);
