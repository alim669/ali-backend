import { PrismaClient, GiftType } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Seed الهدايا بمعرفات ثابتة تتوافق مع Frontend
 * يجب تشغيل هذا الملف: npx ts-node prisma/seed-gifts.ts
 */
async function main() {
  console.log('🎁 Seeding gifts with fixed IDs...');

  // قائمة الهدايا المتوافقة مع Frontend
  const gifts = [
    // هدايا عادية (Normal)
    {
      id: 'rose',
      name: 'وردة',
      description: 'وردة جميلة تعبر عن الحب',
      type: GiftType.STANDARD,
      imageUrl: '🌹',
      price: 10,
      sortOrder: 1,
    },
    {
      id: 'heart',
      name: 'قلب',
      description: 'قلب ينبض بالحب',
      type: GiftType.STANDARD,
      imageUrl: '❤️',
      price: 20,
      sortOrder: 2,
    },
    {
      id: 'clap',
      name: 'تصفيق',
      description: 'تصفيق حار',
      type: GiftType.STANDARD,
      imageUrl: '👏',
      price: 35,
      sortOrder: 3,
    },

    // هدايا ذهبية (Golden)
    {
      id: 'gold_ring',
      name: 'خاتم ذهبي',
      description: 'خاتم ذهبي لامع',
      type: GiftType.ANIMATED,
      imageUrl: '💍',
      price: 150,
      sortOrder: 4,
    },
    {
      id: 'trophy',
      name: 'كأس',
      description: 'كأس البطولة',
      type: GiftType.ANIMATED,
      imageUrl: '🏆',
      price: 250,
      sortOrder: 5,
    },

    // هدايا نادرة (Rare)
    {
      id: 'lion',
      name: 'أسد',
      description: 'أسد شجاع',
      type: GiftType.ANIMATED,
      imageUrl: '🦁',
      price: 500,
      sortOrder: 6,
    },
    {
      id: 'global_crown',
      name: 'التاج الملكي',
      description: 'تاج للملوك',
      type: GiftType.ANIMATED,
      imageUrl: '👑',
      price: 2500,
      sortOrder: 7,
    },
    {
      id: 'global_dragon',
      name: 'التنين الناري',
      description: 'تنين مهيب',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🐉',
      price: 3500,
      sortOrder: 8,
    },
    {
      id: 'global_rocket',
      name: 'الصاروخ الفضائي',
      description: 'صاروخ للفضاء',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🚀',
      price: 4000,
      sortOrder: 9,
    },
    {
      id: 'global_castle',
      name: 'القصر الأسطوري',
      description: 'قصر ضخم',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🏰',
      price: 5000,
      sortOrder: 10,
    },
    {
      id: 'global_throne',
      name: 'العرش الملكي',
      description: 'عرش الملوك',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🔱',
      price: 6000,
      sortOrder: 11,
    },

    // هدايا ملحمية (Epic)
    {
      id: 'epic_phoenix',
      name: 'طائر الفينيق',
      description: 'طائر نار أسطوري',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🔥',
      price: 8000,
      sortOrder: 12,
    },
    {
      id: 'epic_volcano',
      name: 'البركان',
      description: 'بركان ثائر',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🌋',
      price: 10000,
      sortOrder: 13,
    },
    {
      id: 'epic_lightning',
      name: 'عاصفة البرق',
      description: 'عاصفة برقية',
      type: GiftType.VIDEO_VIP,
      imageUrl: '⚡',
      price: 12000,
      sortOrder: 14,
    },

    // هدايا أسطورية (Legendary)
    {
      id: 'lion_vip',
      name: 'Lion King',
      description: 'ملك الغابة VIP',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🦁',
      videoUrl: 'assets/gifts/lion_vip_gift_final.mp4',
      price: 12000,
      sortOrder: 15,
    },
    {
      id: 'legendary_galaxy',
      name: 'المجرة',
      description: 'مجرة كاملة',
      type: GiftType.VIDEO_VIP,
      imageUrl: '🌌',
      price: 25000,
      sortOrder: 16,
    },
    {
      id: 'legendary_diamond_throne',
      name: 'عرش الألماس',
      description: 'عرش من الألماس الخالص',
      type: GiftType.VIDEO_VIP,
      imageUrl: '💎',
      price: 50000,
      sortOrder: 17,
    },
    {
      id: 'legendary_universe',
      name: 'ملك الكون',
      description: 'سيد الكون',
      type: GiftType.VIDEO_VIP,
      imageUrl: '👑',
      price: 100000,
      sortOrder: 18,
    },
  ];

  // إضافة/تحديث كل هدية
  for (const gift of gifts) {
    await prisma.gift.upsert({
      where: { id: gift.id },
      update: {
        name: gift.name,
        description: gift.description,
        type: gift.type,
        imageUrl: gift.imageUrl,
        videoUrl: (gift as any).videoUrl,
        price: gift.price,
        sortOrder: gift.sortOrder,
        isActive: true,
      },
      create: gift,
    });
    console.log(`  ✅ ${gift.name} (${gift.id})`);
  }

  console.log(`\n🎁 تم إضافة ${gifts.length} هدية بنجاح!`);
}

main()
  .catch((e) => {
    console.error('❌ Error seeding gifts:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
