import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

async function fixPasswords() {
  const prisma = new PrismaClient();
  
  console.log('🔐 تحديث كلمات المرور للمستخدمين التجريبيين...\n');
  
  const password = await argon2.hash('Test@123', { type: argon2.argon2id });
  
  const result = await prisma.user.updateMany({
    where: { email: { endsWith: '@test.com' } },
    data: { passwordHash: password }
  });
  
  console.log(`✅ تم تحديث كلمة المرور لـ ${result.count} مستخدم`);
  console.log('\n📧 كلمة المرور الجديدة: Test@123');
  
  await prisma.$disconnect();
}

fixPasswords().catch(console.error);
