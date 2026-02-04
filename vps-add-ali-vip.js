const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 Checking existing gifts...');
  
  // Check all gifts
  const allGifts = await prisma.gift.findMany({
    select: { id: true, name: true, price: true }
  });
  console.log('📋 Current gifts:', allGifts.length);
  allGifts.forEach(g => console.log(`  - ${g.id}: ${g.name} (${g.price})`));
  
  // Check if ali_vip exists
  const aliVip = await prisma.gift.findUnique({
    where: { id: 'ali_vip' }
  });
  
  if (aliVip) {
    console.log('✅ ali_vip already exists:', aliVip);
  } else {
    console.log('❌ ali_vip NOT found, adding...');
    
    // Add ali_vip
    const newGift = await prisma.gift.create({
      data: {
        id: 'ali_vip',
        name: 'علي VIP',
        price: 60000,
        type: 'VIDEO_VIP',
        imageUrl: 'assets/gifts/ali-vip.png',
        videoUrl: 'assets/gifts/ali-vip.mp4',
        isActive: true,
        sortOrder: 0
      }
    });
    console.log('✅ Added ali_vip successfully:', newGift);
  }
  
  await prisma.$disconnect();
}

main().catch(e => {
  console.error('Error:', e.message);
  prisma.$disconnect();
});
