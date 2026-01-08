const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst({ 
    where: { email: 'sdad34461@gmail.com' } 
  });
  
  if (!user) { 
    console.log('User not found'); 
    return; 
  }
  
  console.log('Found user:', user.id, user.email);
  
  const wallet = await prisma.wallet.upsert({ 
    where: { userId: user.id }, 
    update: { balance: { increment: 10000000 } }, 
    create: { userId: user.id, balance: 10000000, diamonds: 0 } 
  });
  
  console.log('SUCCESS: Added 10,000,000 coins');
  console.log('New balance:', wallet.balance);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
