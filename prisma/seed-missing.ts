import { PrismaClient, GiftType } from '@prisma/client';

const prisma = new PrismaClient();

async function seedMissingData() {
  console.log('🌱 Adding missing data...');

  // Check and create gifts
  const existingGifts = await prisma.gift.count();
  if (existingGifts === 0) {
    const gifts = [
      {
        name: 'وردة حمراء',
        description: 'وردة جميلة تعبر عن الحب',
        type: GiftType.STANDARD,
        imageUrl: 'https://cdn.example.com/gifts/red-rose.png',
        price: 10,
        sortOrder: 1,
      },
      {
        name: 'قلب',
        description: 'قلب ينبض بالحب',
        type: GiftType.ANIMATED,
        imageUrl: 'https://cdn.example.com/gifts/heart.png',
        animationUrl: 'https://cdn.example.com/gifts/heart.json',
        price: 50,
        sortOrder: 2,
      },
      {
        name: 'تاج ذهبي',
        description: 'تاج للملوك والملكات',
        type: GiftType.ANIMATED,
        imageUrl: 'https://cdn.example.com/gifts/crown.png',
        animationUrl: 'https://cdn.example.com/gifts/crown.json',
        price: 200,
        sortOrder: 3,
      },
      {
        name: 'سيارة فاخرة',
        description: 'سيارة VIP للمميزين',
        type: GiftType.VIDEO_VIP,
        imageUrl: 'https://cdn.example.com/gifts/car.png',
        videoUrl: 'https://cdn.example.com/gifts/car.mp4',
        price: 1000,
        sortOrder: 4,
      },
      {
        name: 'يخت',
        description: 'يخت فاخر في البحر',
        type: GiftType.VIDEO_VIP,
        imageUrl: 'https://cdn.example.com/gifts/yacht.png',
        videoUrl: 'https://cdn.example.com/gifts/yacht.mp4',
        price: 5000,
        sortOrder: 5,
      },
      {
        name: 'طائرة خاصة',
        description: 'طائرة VIP حصرية',
        type: GiftType.VIDEO_VIP,
        imageUrl: 'https://cdn.example.com/gifts/jet.png',
        videoUrl: 'https://cdn.example.com/gifts/jet.mp4',
        price: 10000,
        sortOrder: 6,
      },
      {
        name: 'نجمة',
        description: 'نجمة لامعة',
        type: GiftType.STANDARD,
        imageUrl: 'https://cdn.example.com/gifts/star.png',
        price: 5,
        sortOrder: 7,
      },
      {
        name: 'كيكة عيد ميلاد',
        description: 'احتفل بعيد الميلاد',
        type: GiftType.ANIMATED,
        imageUrl: 'https://cdn.example.com/gifts/cake.png',
        animationUrl: 'https://cdn.example.com/gifts/cake.json',
        price: 100,
        sortOrder: 8,
      },
      {
        name: 'باقة ورد',
        description: 'باقة ورد جميلة',
        type: GiftType.STANDARD,
        imageUrl: 'https://cdn.example.com/gifts/bouquet.png',
        price: 30,
        sortOrder: 9,
      },
      {
        name: 'قصر',
        description: 'قصر ملكي فاخر',
        type: GiftType.VIDEO_VIP,
        imageUrl: 'https://cdn.example.com/gifts/palace.png',
        videoUrl: 'https://cdn.example.com/gifts/palace.mp4',
        price: 50000,
        sortOrder: 10,
      },
    ];

    await prisma.gift.createMany({ data: gifts });
    console.log(`✅ ${gifts.length} gifts created`);
  } else {
    console.log(`ℹ️ Gifts already exist (${existingGifts})`);
  }

  // Create system settings
  const settings = [
    { key: 'min_withdraw_amount', value: { amount: 100 }, description: 'الحد الأدنى للسحب' },
    { key: 'gift_commission', value: { percentage: 20 }, description: 'نسبة عمولة الهدايا' },
    { key: 'max_rooms_per_user', value: { count: 5 }, description: 'أقصى عدد غرف للمستخدم' },
    { key: 'maintenance_mode', value: { enabled: false }, description: 'وضع الصيانة' },
    { key: 'min_deposit_amount', value: { amount: 10 }, description: 'الحد الأدنى للإيداع' },
    { key: 'max_message_length', value: { length: 1000 }, description: 'أقصى طول رسالة' },
    { key: 'max_room_members', value: { count: 1000 }, description: 'أقصى أعضاء للغرفة' },
    { key: 'allow_registration', value: { enabled: true }, description: 'السماح بالتسجيل' },
    { key: 'require_email_verification', value: { enabled: false }, description: 'طلب تأكيد البريد' },
    { key: 'diamond_to_coin_rate', value: { rate: 10 }, description: 'نسبة تحويل الماس للعملات' },
  ];

  let settingsCreated = 0;
  for (const setting of settings) {
    const existing = await prisma.systemSetting.findUnique({ where: { key: setting.key } });
    if (!existing) {
      await prisma.systemSetting.create({ data: setting });
      settingsCreated++;
    }
  }
  console.log(`✅ ${settingsCreated} new settings created`);

  // Verify wallets for all users
  const usersWithoutWallet = await prisma.user.findMany({
    where: { wallet: null },
    select: { id: true, username: true },
  });

  if (usersWithoutWallet.length > 0) {
    for (const user of usersWithoutWallet) {
      await prisma.wallet.create({
        data: {
          userId: user.id,
          balance: 0,
          diamonds: 0,
        },
      });
    }
    console.log(`✅ Created wallets for ${usersWithoutWallet.length} users`);
  }

  // Final counts
  const finalCounts = {
    users: await prisma.user.count(),
    rooms: await prisma.room.count(),
    gifts: await prisma.gift.count(),
    settings: await prisma.systemSetting.count(),
    wallets: await prisma.wallet.count(),
  };

  console.log('\n📊 Database Summary:');
  console.log(`   👤 Users: ${finalCounts.users}`);
  console.log(`   🏠 Rooms: ${finalCounts.rooms}`);
  console.log(`   🎁 Gifts: ${finalCounts.gifts}`);
  console.log(`   ⚙️ Settings: ${finalCounts.settings}`);
  console.log(`   💰 Wallets: ${finalCounts.wallets}`);

  console.log('\n✅ Database ready for production!');
}

seedMissingData()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
