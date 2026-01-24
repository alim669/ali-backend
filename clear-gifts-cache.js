const { PrismaClient } = require('@prisma/client');
const Redis = require('ioredis');

async function clearGiftsCache() {
  console.log('🗑️ جاري مسح cache الهدايا...');
  
  const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
  
  try {
    // مسح cache الهدايا
    await redis.del('gifts:list');
    console.log('✅ تم مسح cache الهدايا');
    
    // التحقق من الهدايا في قاعدة البيانات
    const prisma = new PrismaClient();
    const gifts = await prisma.gift.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });
    
    console.log(`\n📊 عدد الهدايا في قاعدة البيانات: ${gifts.length}`);
    gifts.forEach((g, i) => {
      console.log(`  ${i + 1}. ${g.id}: ${g.name} (${g.type}) - ${g.price} coins`);
    });
    
    // إعادة تخزين الهدايا في الـ cache
    await redis.set('gifts:list', JSON.stringify(gifts), 'EX', 3600);
    console.log('\n✅ تم إعادة تخزين الهدايا في cache');
    
    await prisma.$disconnect();
    redis.disconnect();
  } catch (error) {
    console.error('❌ خطأ:', error.message);
    redis.disconnect();
    process.exit(1);
  }
}

clearGiftsCache();
