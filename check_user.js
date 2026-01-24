const { PrismaClient } = require('@prisma/client');
const argon2 = require('argon2');

async function main() {
  const p = new PrismaClient();
  
  try {
    // List all users
    const users = await p.user.findMany({
      select: { email: true, authProvider: true },
      take: 10
    });
    console.log('All users:', JSON.stringify(users, null, 2));
    
    const user = await p.user.findFirst({
      where: { email: 'hfyds65@gmail.com' },
      select: { email: true, passwordHash: true, authProvider: true }
    });
    
    console.log('User found:', JSON.stringify(user, null, 2));
    
    if (user && user.passwordHash) {
      // Test password verification
      const testPassword = 'wtpan2002SDAM';
      try {
        const isValid = await argon2.verify(user.passwordHash, testPassword);
        console.log('Password valid:', isValid);
      } catch (e) {
        console.log('Argon2 error:', e.message);
      }
    }
  } finally {
    await p.$disconnect();
  }
}

main();
