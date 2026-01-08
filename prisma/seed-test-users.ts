import { PrismaClient, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/**
 * Seed مستخدمين تجريبيين للاختبار
 * كلمة المرور لجميع المستخدمين: Test@123
 */
async function main() {
  console.log('👥 إنشاء مستخدمين تجريبيين...\n');

  const password = await argon2.hash('Test@123', { type: argon2.argon2id });

  // قائمة المستخدمين التجريبيين
  const testUsers = [
    {
      email: 'ahmed@test.com',
      username: 'ahmed_test',
      displayName: 'أحمد محمد',
      avatar: 'https://i.pravatar.cc/150?img=1',
      bio: 'مرحباً، أنا أحمد!',
      balance: 50000,
      diamonds: 500,
    },
    {
      email: 'sara@test.com',
      username: 'sara_test',
      displayName: 'سارة أحمد',
      avatar: 'https://i.pravatar.cc/150?img=5',
      bio: 'أحب الغرف الصوتية 🎤',
      balance: 75000,
      diamonds: 800,
    },
    {
      email: 'ali@test.com',
      username: 'ali_test',
      displayName: 'علي حسين',
      avatar: 'https://i.pravatar.cc/150?img=3',
      bio: 'هواياتي الألعاب والموسيقى',
      balance: 100000,
      diamonds: 1000,
    },
    {
      email: 'fatima@test.com',
      username: 'fatima_test',
      displayName: 'فاطمة علي',
      avatar: 'https://i.pravatar.cc/150?img=9',
      bio: '✨ VIP Member ✨',
      balance: 200000,
      diamonds: 2000,
    },
    {
      email: 'omar@test.com',
      username: 'omar_test',
      displayName: 'عمر خالد',
      avatar: 'https://i.pravatar.cc/150?img=7',
      bio: 'أحب التواصل مع الأصدقاء',
      balance: 30000,
      diamonds: 300,
    },
    {
      email: 'layla@test.com',
      username: 'layla_test',
      displayName: 'ليلى محمود',
      avatar: 'https://i.pravatar.cc/150?img=10',
      bio: '🌟 مغنية 🎵',
      balance: 150000,
      diamonds: 1500,
    },
    {
      email: 'hassan@test.com',
      username: 'hassan_test',
      displayName: 'حسن عبدالله',
      avatar: 'https://i.pravatar.cc/150?img=11',
      bio: 'مضيف غرف محترف',
      balance: 80000,
      diamonds: 900,
    },
    {
      email: 'nour@test.com',
      username: 'nour_test',
      displayName: 'نور الهدى',
      avatar: 'https://i.pravatar.cc/150?img=20',
      bio: '💎 أحب الهدايا 💎',
      balance: 500000,
      diamonds: 5000,
    },
    {
      email: 'khalid@test.com',
      username: 'khalid_test',
      displayName: 'خالد العمري',
      avatar: 'https://i.pravatar.cc/150?img=12',
      bio: 'DJ 🎧',
      balance: 120000,
      diamonds: 1200,
    },
    {
      email: 'mona@test.com',
      username: 'mona_test',
      displayName: 'منى السعيد',
      avatar: 'https://i.pravatar.cc/150?img=25',
      bio: 'صديقة الجميع 😊',
      balance: 60000,
      diamonds: 600,
    },
  ];

  console.log('📝 إنشاء المستخدمين:\n');

  for (const userData of testUsers) {
    try {
      const user = await prisma.user.upsert({
        where: { email: userData.email },
        update: {
          displayName: userData.displayName,
          avatar: userData.avatar,
          bio: userData.bio,
          wallet: {
            upsert: {
              create: {
                balance: userData.balance,
                diamonds: userData.diamonds,
              },
              update: {
                balance: userData.balance,
                diamonds: userData.diamonds,
              },
            },
          },
        },
        create: {
          email: userData.email,
          username: userData.username,
          displayName: userData.displayName,
          passwordHash: password,
          avatar: userData.avatar,
          bio: userData.bio,
          emailVerified: true,
          role: UserRole.USER,
          wallet: {
            create: {
              balance: userData.balance,
              diamonds: userData.diamonds,
            },
          },
        },
        include: { wallet: true },
      });

      console.log(`  ✅ ${user.displayName}`);
      console.log(`     📧 ${user.email}`);
      console.log(`     💰 ${userData.balance.toLocaleString()} نقطة`);
      console.log(`     💎 ${userData.diamonds.toLocaleString()} ماسة`);
      console.log('');
    } catch (error: any) {
      console.error(`  ❌ خطأ في إنشاء ${userData.displayName}: ${error.message}`);
    }
  }

  // إنشاء غرفة تجريبية
  console.log('\n🏠 إنشاء غرفة تجريبية...\n');

  const firstUser = await prisma.user.findUnique({
    where: { email: 'nour@test.com' },
  });

  if (firstUser) {
    const room = await prisma.room.upsert({
      where: { id: 'test-room-1' },
      update: {},
      create: {
        id: 'test-room-1',
        name: '🎤 غرفة الاختبار',
        description: 'غرفة تجريبية لاختبار الميزات',
        ownerId: firstUser.id,
        maxMembers: 50,
      },
    });

    console.log(`  ✅ تم إنشاء الغرفة: ${room.name}`);
    console.log(`     🔑 معرف الغرفة: ${room.id}`);

    // إضافة بعض المستخدمين للغرفة
    const usersToAdd = ['ahmed@test.com', 'sara@test.com', 'ali@test.com', 'fatima@test.com', 'omar@test.com'];
    
    for (const email of usersToAdd) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (user) {
        await prisma.roomMember.upsert({
          where: {
            roomId_userId: {
              roomId: room.id,
              userId: user.id,
            },
          },
          update: {},
          create: {
            roomId: room.id,
            userId: user.id,
          },
        });
      }
    }
    console.log(`  ✅ تم إضافة 5 أعضاء للغرفة`);
  }

  console.log('\n' + '═'.repeat(50));
  console.log('✅ تم إنشاء جميع المستخدمين التجريبيين بنجاح!');
  console.log('═'.repeat(50));
  console.log('\n📋 معلومات تسجيل الدخول:');
  console.log('   كلمة المرور لجميع المستخدمين: Test@123');
  console.log('\n🧪 مستخدمين موصى بهم للاختبار:');
  console.log('   1. nour@test.com (500,000 نقطة) - لإرسال هدايا كبيرة');
  console.log('   2. fatima@test.com (200,000 نقطة) - VIP');
  console.log('   3. ahmed@test.com (50,000 نقطة) - مستخدم عادي');
  console.log('');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
