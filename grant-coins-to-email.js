const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

const prisma = new PrismaClient();

function safeUsernameBase(email) {
  const local = (email.split('@')[0] || 'user').toLowerCase();
  const cleaned = local.replace(/[^a-z0-9_]/g, '_').replace(/_+/g, '_');
  return cleaned.length > 2 ? cleaned : `user_${Date.now()}`;
}

async function ensureUniqueUsername(base) {
  let candidate = base;
  let i = 0;
  while (true) {
    const exists = await prisma.user.findUnique({ where: { username: candidate } });
    if (!exists) return candidate;
    i += 1;
    candidate = `${base}_${i}`;
  }
}

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  const amountRaw = (process.argv[3] || '').trim();

  if (!email) {
    console.error('Usage: node grant-coins-to-email.js <email> <amount>');
    process.exitCode = 2;
    return;
  }

  const amount = Number.parseInt(amountRaw, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    console.error('Invalid amount. Usage: node grant-coins-to-email.js <email> <amount>');
    process.exitCode = 2;
    return;
  }

  let user = await prisma.user.findUnique({ where: { email } });

  // If user doesn't exist, create one with a known dev password.
  if (!user) {
    const devPassword = 'Test@123';
    const username = await ensureUniqueUsername(safeUsernameBase(email));
    const passwordHash = await argon2.hash(devPassword);

    user = await prisma.user.create({
      data: {
        email,
        username,
        displayName: 'Owner',
        passwordHash,
        authProvider: 'EMAIL',
        role: 'SUPER_ADMIN',
        status: 'ACTIVE',
        emailVerified: true,
      },
    });

    console.log(`✅ Created user for ${email}`);
    console.log(`   username: ${user.username}`);
    console.log(`   password: ${devPassword}`);
    console.log('   role: SUPER_ADMIN');
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
