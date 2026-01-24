const argon2 = require('argon2');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const email = 'sdad34461@gmail.com';
  const newPassword = 'Owner123456';
  
  const hash = await argon2.hash(newPassword);
  
  await prisma.user.update({
    where: { email },
    data: { passwordHash: hash }
  });
  
  console.log('✅ تم تحديث كلمة المرور');
  console.log('📧 Email:', email);
  console.log('🔑 Password:', newPassword);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
