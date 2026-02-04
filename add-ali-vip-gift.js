const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addAliVipGift() {
  const gift = {
    id: 'ali_vip',
    name: 'علي VIP',
    price: 60000,
    type: 'VIDEO_VIP',
    imageUrl: 'assets/gifts/ali-vip.png',
    videoUrl: 'assets/gifts/ali-vip.mp4'
  };
  
  try {
    await prisma.gift.upsert({
      where: { id: gift.id },
      update: gift,
      create: gift
    });
    console.log('✅ Added ali_vip gift successfully!');
    console.log('   - ID:', gift.id);
    console.log('   - Name:', gift.name);
    console.log('   - Price:', gift.price);
    console.log('   - Type:', gift.type);
  } catch (error) {
    console.error('❌ Error adding gift:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

addAliVipGift();
