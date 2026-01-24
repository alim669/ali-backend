import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const giftPrices: Record<string, number> = {
  'rose': 10,
  'heart': 20,
  'clap': 35,
  'gold_ring': 150,
  'trophy': 250,
  'lion': 500,
};

async function simulateGifts() {
  console.log('🎭 محاكاة إرسال الهدايا...\n');
  
  // الحصول على المستخدمين
  const users = await prisma.user.findMany({
    where: { email: { endsWith: '@test.com' } },
    include: { wallet: true },
    take: 5,
  });
  
  if (users.length < 2) {
    console.log('❌ لا يوجد مستخدمين كافيين');
    return;
  }
  
  // الحصول على الغرفة الأولى
  const room = await prisma.room.findFirst();
  if (!room) {
    console.log('❌ لا توجد غرف');
    return;
  }
  
  console.log(`📍 الغرفة: ${room.name}\n`);
  console.log('🎁 إرسال الهدايا:\n');
  
  const gifts = Object.keys(giftPrices);
  
  for (let i = 0; i < 5; i++) {
    const senderIdx = Math.floor(Math.random() * users.length);
    let receiverIdx = Math.floor(Math.random() * users.length);
    while (receiverIdx === senderIdx) {
      receiverIdx = Math.floor(Math.random() * users.length);
    }
    
    const sender = users[senderIdx];
    const receiver = users[receiverIdx];
    const giftId = gifts[Math.floor(Math.random() * gifts.length)];
    const price = giftPrices[giftId];
    
    console.log(`  🎁 ${sender.displayName} ➜ ${receiver.displayName} (${giftId}) - ${price} نقطة`);
    
    try {
      // التحقق من الرصيد
      if (!sender.wallet || sender.wallet.balance < price) {
        console.log(`     ⚠️ رصيد غير كافي`);
        continue;
      }
      
      const priceBig = BigInt(price);

      // إنشاء transaction
      await prisma.$transaction(async (tx) => {
        // خصم من المرسل
        await tx.wallet.update({
          where: { userId: sender.id },
          data: { balance: { decrement: priceBig } }
        });
        
        // إضافة للمستلم
        if (receiver.wallet) {
          await tx.wallet.update({
            where: { userId: receiver.id },
            data: { balance: { increment: BigInt(Math.floor(price * 0.7)) } }
          });
        }
        
        // تسجيل الهدية
        await tx.giftSend.create({
          data: {
            senderId: sender.id,
            receiverId: receiver.id,
            giftId: giftId,
            quantity: 1,
            totalPrice: price,
            roomId: room.id,
            idempotencyKey: `sim-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          }
        });
      });
      
      console.log(`     ✅ تم الإرسال بنجاح!`);
      
      // تحديث رصيد المستخدم محلياً
      if (sender.wallet) {
        sender.wallet.balance -= priceBig;
      }
      
    } catch (error: any) {
      console.log(`     ❌ خطأ: ${error.message}`);
    }
    
    // انتظار
    await new Promise(r => setTimeout(r, 1500));
  }
  
  console.log('\n✨ انتهت المحاكاة!');
  await prisma.$disconnect();
}

simulateGifts().catch(console.error);
