/**
 * 🎁 محاكاة إرسال الهدايا عبر Redis Pub/Sub
 * هذا السكريبت يرسل رسائل مباشرة إلى Redis لتظهر في التطبيق
 */

import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';

const prisma = new PrismaClient();

// استخدام نفس Redis من البيئة (بدون أي بيانات ثابتة/IP عام داخل الكود)
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || '6379';
const REDIS_USERNAME = process.env.REDIS_USERNAME || 'default';
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || '';

const REDIS_URL = process.env.REDIS_URL || (
  REDIS_PASSWORD
    ? `redis://${encodeURIComponent(REDIS_USERNAME)}:${encodeURIComponent(REDIS_PASSWORD)}@${REDIS_HOST}:${REDIS_PORT}`
    : `redis://${REDIS_HOST}:${REDIS_PORT}`
);

const giftIds = ['rose', 'heart', 'clap', 'gold_ring', 'trophy', 'lion'];
const giftNames: Record<string, string> = {
  'rose': 'وردة',
  'heart': 'قلب',
  'clap': 'تصفيق',
  'gold_ring': 'خاتم ذهبي',
  'trophy': 'كأس',
  'lion': 'أسد'
};
const giftPrices: Record<string, number> = {
  'rose': 10,
  'heart': 50,
  'clap': 100,
  'gold_ring': 500,
  'trophy': 1000,
  'lion': 5000
};

async function main() {
  console.log('🎭 محاكاة إرسال الهدايا عبر Redis Pub/Sub...\n');
  
  // الاتصال بـ Redis
  const redis = new Redis(REDIS_URL);
  console.log('✅ تم الاتصال بـ Redis\n');
  
  // جلب المستخدمين
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@test.com' } },
    take: 10,
  });
  
  if (users.length < 2) {
    console.log('❌ لا يوجد مستخدمين كافيين');
    await redis.quit();
    await prisma.$disconnect();
    return;
  }
  
  console.log(`✅ وجدت ${users.length} مستخدمين\n`);
  
  // جلب غرفة نشطة
  const room = await prisma.room.findFirst({
    include: {
      owner: true
    },
    orderBy: { currentMembers: 'desc' }
  });
  
  if (!room) {
    console.log('❌ لا يوجد غرف');
    await redis.quit();
    await prisma.$disconnect();
    return;
  }
  
  console.log(`✅ الغرفة المختارة: ${room.name} (${room.id})`);
  console.log(`   👥 عدد الأعضاء: ${room.currentMembers}\n`);
  
  // إرسال 10 هدايا
  console.log('🎁 بدء إرسال الهدايا...\n');
  
  for (let i = 0; i < 10; i++) {
    // اختيار مرسل ومستقبل عشوائيين
    const senderIndex = Math.floor(Math.random() * users.length);
    let receiverIndex = Math.floor(Math.random() * users.length);
    while (receiverIndex === senderIndex && users.length > 1) {
      receiverIndex = Math.floor(Math.random() * users.length);
    }
    
    const sender = users[senderIndex];
    const receiver = users[receiverIndex];
    const giftId = giftIds[Math.floor(Math.random() * giftIds.length)];
    const count = Math.floor(Math.random() * 5) + 1;
    
    // إنشاء رسالة الهدية
    const giftEvent = {
      type: 'gift_received',
      data: {
        id: `gift-sim-${Date.now()}-${i}`,
        roomId: room.id,
        senderId: sender.id,
        receiverId: receiver.id,
        senderName: sender.displayName || sender.username,
        senderAvatar: sender.avatar,
        receiverName: receiver.displayName || receiver.username,
        receiverAvatar: receiver.avatar,
        giftId: giftId,
        giftName: giftNames[giftId] || giftId,
        giftPrice: giftPrices[giftId] || 100,
        count: count,
        totalValue: (giftPrices[giftId] || 100) * count,
        createdAt: new Date().toISOString(),
      }
    };
    
    // إرسال عبر Redis
    await redis.publish('gifts:sent', JSON.stringify(giftEvent));
    
    console.log(`   🎁 ${sender.displayName || sender.username} ➜ ${receiver.displayName || receiver.username}: ${count}x ${giftNames[giftId] || giftId}`);
    
    // انتظار 2 ثانية بين كل هدية
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log('\n✅ تم إرسال جميع الهدايا!');
  console.log('📱 يجب أن تظهر الهدايا الآن في التطبيق');
  
  await redis.quit();
  await prisma.$disconnect();
}

main().catch(console.error);
