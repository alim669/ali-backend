const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const amountRaw = (process.argv[3] || '').trim();

  if (!email) {
    console.error('Usage: node add-coins-email.js <email> <amount>');
    process.exitCode = 2;
    return;
  }

  const amount = Number.parseInt(amountRaw, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('Invalid amount. Usage: node add-coins-email.js <email> <amount>');
    process.exitCode = 2;
    return;
  }

  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    console.error(`User not found for email: ${email}`);
    process.exitCode = 3;
    return;
  }

  const wallet = await prisma.wallet.upsert({
    where: { userId: user.id },
    update: { balance: { increment: amount } },
    create: { userId: user.id, balance: amount, diamonds: 0 },
  });

  console.log(`✅ Added ${amount.toLocaleString('en-US')} coins to ${user.email}`);
  console.log(`UserId: ${user.id}`);
  console.log(`New balance: ${wallet.balance.toLocaleString('en-US')}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
