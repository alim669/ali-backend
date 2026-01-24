const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function seed() {
  const gifts = [
    { id: 'rose', name: 'وردة', price: 10, type: 'STANDARD', imageUrl: 'assets/gifts/rose.png' },
    { id: 'heart', name: 'قلب', price: 20, type: 'STANDARD', imageUrl: 'assets/gifts/heart.png' },
    { id: 'clap', name: 'تصفيق', price: 35, type: 'STANDARD', imageUrl: 'assets/gifts/clap.png' },
    { id: 'kiss', name: 'قبلة', price: 50, type: 'STANDARD', imageUrl: 'assets/gifts/kiss.png' },
    { id: 'star', name: 'نجمة', price: 100, type: 'ANIMATED', imageUrl: 'assets/gifts/star.png' },
    { id: 'crown', name: 'تاج', price: 500, type: 'ANIMATED', imageUrl: 'assets/gifts/crown.png' },
    { id: 'diamond', name: 'ماسة', price: 1000, type: 'VIDEO_VIP', imageUrl: 'assets/gifts/diamond.png' },
    { id: 'rocket', name: 'صاروخ', price: 2000, type: 'VIDEO_VIP', imageUrl: 'assets/gifts/rocket.png' },
    { id: 'castle', name: 'قلعة', price: 5000, type: 'VIDEO_VIP', imageUrl: 'assets/gifts/castle.png' },
    { id: 'lion_vip', name: 'Lion King', price: 12000, type: 'VIDEO_VIP', imageUrl: 'assets/gifts/lion.png', videoUrl: 'assets/gifts/lion_vip_gift_final.mp4' },
    { id: 'ferrari_vip', name: 'Ferrari VIP', price: 15000, type: 'VIDEO_VIP', imageUrl: 'assets/gifts/ferrari.png', videoUrl: 'assets/gifts/ferrari_vip.mp4' },
    { id: 'lion', name: 'أسد', price: 200, type: 'ANIMATED', imageUrl: 'assets/gifts/lion.png' },
    { id: 'trophy', name: 'كأس', price: 150, type: 'ANIMATED', imageUrl: 'assets/gifts/trophy.png' },
    { id: 'gold_ring', name: 'خاتم ذهبي', price: 300, type: 'ANIMATED', imageUrl: 'assets/gifts/gold_ring.png' },
  ];
  
  for (const g of gifts) {
    await prisma.gift.upsert({ where: { id: g.id }, update: g, create: g });
    console.log('Added:', g.name);
  }
  
  console.log('✅ Added', gifts.length, 'gifts');
  await prisma.$disconnect();
}

seed().catch(console.error);
