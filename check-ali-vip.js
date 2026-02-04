const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkGifts() {
  try {
    // البحث عن هدية ali_vip
    const aliVip = await prisma.gift.findUnique({
      where: { id: 'ali_vip' }
    });
    
    console.log('🔍 Searching for ali_vip gift...');
    if (aliVip) {
      console.log('✅ Found ali_vip:', aliVip);
    } else {
      console.log('❌ ali_vip NOT FOUND in database!');
    }
    
    // عرض جميع الهدايا
    console.log('\n📋 All gifts in database:');
    const allGifts = await prisma.gift.findMany({
      select: { id: true, name: true, price: true, type: true }
    });
    allGifts.forEach(g => {
      console.log(`  - ${g.id}: ${g.name} (${g.price} coins, ${g.type})`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

checkGifts();
