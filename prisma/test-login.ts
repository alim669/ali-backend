import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

async function testLogin() {
  const prisma = new PrismaClient();
  
  console.log('🔍 فحص مستخدم nour@test.com...\n');
  
  const user = await prisma.user.findUnique({
    where: { email: 'nour@test.com' },
    select: {
      id: true,
      email: true,
      displayName: true,
      passwordHash: true,
      status: true,
    }
  });
  
  if (!user) {
    console.log('❌ المستخدم غير موجود!');
    await prisma.$disconnect();
    return;
  }
  
  console.log('📧 البريد:', user.email);
  console.log('👤 الاسم:', user.displayName);
  console.log('📊 الحالة:', user.status);
  console.log('🔐 كلمة المرور موجودة:', !!user.passwordHash);
  
  if (user.passwordHash) {
    console.log('\n🧪 اختبار كلمة المرور Test@123...');
    const isValid = await argon2.verify(user.passwordHash, 'Test@123');
    console.log('✅ النتيجة:', isValid ? 'صحيحة!' : 'غير صحيحة!');
  }
  
  await prisma.$disconnect();
}

testLogin().catch(console.error);
