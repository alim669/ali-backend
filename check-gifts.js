const { PrismaClient } = require('@prisma/client');

async function listGifts() {
  const prisma = new PrismaClient();
  
  console.log('='.repeat(70));
  console.log('                    🎁 قائمة الهدايا في قاعدة البيانات');
  console.log('='.repeat(70));
  
  const gifts = await prisma.gift.findMany({
    orderBy: { sortOrder: 'asc' }
  });
  
  console.log(`\n📊 العدد الإجمالي: ${gifts.length} هدية\n`);
  
  gifts.forEach((gift, i) => {
    console.log(`${i + 1}. 🎁 ${gift.name}`);
    console.log(`   💰 السعر: ${gift.price} coins`);
    console.log(`   🏷️ النوع: ${gift.type}`);
    console.log(`   🖼️ الصورة: ${gift.imageUrl || '❌ لا توجد'}`);
    console.log(`   🎬 الأنيميشن: ${gift.animationUrl || '❌ لا يوجد'}`);
    console.log(`   📹 الفيديو: ${gift.videoUrl || '❌ لا يوجد'}`);
    console.log(`   ✅ مفعّل: ${gift.isActive ? 'نعم' : 'لا'}`);
    console.log('-'.repeat(70));
  });
  
  // جلب سجل الهدايا المرسلة
  const sentGifts = await prisma.giftSend.findMany({
    take: 10,
    orderBy: { createdAt: 'desc' },
    include: {
      gift: { select: { name: true } },
      sender: { select: { displayName: true } },
      receiver: { select: { displayName: true } }
    }
  });
  
  console.log('\n📤 آخر 10 هدايا مرسلة:');
  console.log('-'.repeat(70));
  
  if (sentGifts.length === 0) {
    console.log('❌ لا توجد هدايا مرسلة بعد');
  } else {
    sentGifts.forEach((send, i) => {
      console.log(`${i + 1}. ${send.sender.displayName} ➡️ ${send.receiver.displayName}: ${send.gift.name} (x${send.quantity})`);
    });
  }
  
  await prisma.$disconnect();
}

listGifts().catch(console.error);
