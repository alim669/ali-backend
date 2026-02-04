// سكريبت لإضافة هدية الطائرة العسكرية مباشرة
// شغله على VPS: node add-military-plane.js

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function addMilitaryPlane() {
  console.log('🛩️ جاري إضافة هدية الطائرة العسكرية...\n');

  const gift = {
    id: 'military_plane',
    name: 'الطائرة العسكرية',
    price: 100000,
    type: 'VIDEO_VIP',
    imageUrl: 'assets/gifts/plane.png',
    videoUrl: 'assets/gifts/Military plane.mp4',
    isActive: true,
  };

  try {
    const result = await prisma.gift.upsert({
      where: { id: gift.id },
      update: gift,
      create: gift,
    });

    console.log('✅ تمت إضافة/تحديث الهدية بنجاح!');
    console.log('📦 البيانات:', result);
  } catch (error) {
    console.error('❌ خطأ:', error.message);
  } finally {
    await prisma.$disconnect();
  }
}

addMilitaryPlane();
