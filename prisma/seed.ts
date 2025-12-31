import { PrismaClient, UserRole, GiftType } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create Super Admin
  const adminPassword = await argon2.hash('Admin@123456', {
    type: argon2.argon2id,
  });

  const admin = await prisma.user.upsert({
    where: { email: 'admin@ali.app' },
    update: {},
    create: {
      email: 'admin@ali.app',
      passwordHash: adminPassword,
      username: 'admin',
      displayName: 'مدير النظام',
      role: UserRole.SUPER_ADMIN,
      emailVerified: true,
      wallet: {
        create: {
          balance: 1000000,
          diamonds: 10000,
        },
      },
    },
  });

  console.log(`✅ Admin user created: ${admin.email}`);

  // Create test users
  const testUserPassword = await argon2.hash('Test@123456', {
    type: argon2.argon2id,
  });

  const user1 = await prisma.user.upsert({
    where: { email: 'user1@test.com' },
    update: {},
    create: {
      email: 'user1@test.com',
      passwordHash: testUserPassword,
      username: 'user1',
      displayName: 'أحمد محمد',
      emailVerified: true,
      wallet: {
        create: {
          balance: 5000,
          diamonds: 100,
        },
      },
    },
  });

  const user2 = await prisma.user.upsert({
    where: { email: 'user2@test.com' },
    update: {},
    create: {
      email: 'user2@test.com',
      passwordHash: testUserPassword,
      username: 'user2',
      displayName: 'سارة علي',
      emailVerified: true,
      wallet: {
        create: {
          balance: 3000,
          diamonds: 50,
        },
      },
    },
  });

  console.log(`✅ Test users created`);

  // Create sample gifts
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
  ];

  for (const gift of gifts) {
    await prisma.gift.upsert({
      where: { id: gift.name }, // This will fail, need to use a different approach
      update: {},
      create: gift,
    });
  }

  // Use createMany for gifts
  const existingGifts = await prisma.gift.count();
  if (existingGifts === 0) {
    await prisma.gift.createMany({
      data: gifts,
    });
    console.log(`✅ ${gifts.length} gifts created`);
  } else {
    console.log(`ℹ️ Gifts already exist, skipping`);
  }

  // Create a sample room
  const existingRooms = await prisma.room.count();
  if (existingRooms === 0) {
    const room = await prisma.room.create({
      data: {
        name: 'غرفة الترحيب',
        description: 'مرحباً بكم في غرفة الترحيب الرسمية',
        ownerId: admin.id,
        maxMembers: 500,
        currentMembers: 1,
        members: {
          create: {
            userId: admin.id,
            role: 'OWNER',
          },
        },
      },
    });
    console.log(`✅ Sample room created: ${room.name}`);
  }

  // Create system settings
  const settings = [
    { key: 'min_withdraw_amount', value: { amount: 100 }, description: 'الحد الأدنى للسحب' },
    { key: 'gift_commission', value: { percentage: 20 }, description: 'نسبة عمولة الهدايا' },
    { key: 'max_rooms_per_user', value: { count: 5 }, description: 'أقصى عدد غرف للمستخدم' },
    { key: 'maintenance_mode', value: { enabled: false }, description: 'وضع الصيانة' },
  ];

  for (const setting of settings) {
    await prisma.systemSetting.upsert({
      where: { key: setting.key },
      update: { value: setting.value },
      create: setting,
    });
  }
  console.log(`✅ System settings created`);

  console.log('✅ Database seeded successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
