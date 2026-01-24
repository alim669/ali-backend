const { PrismaClient } = require('@prisma/client');

const USER_START = 1682805400n;
const ROOM_START = 100200300n;

const toBigInt = (value) => {
  if (value === null || value === undefined) return 0n;
  try {
    return BigInt(value.toString());
  } catch {
    return 0n;
  }
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const userMaxRows = await prisma.$queryRawUnsafe(
      'SELECT MAX("numericId")::bigint AS max FROM "User"'
    );
    const roomMaxRows = await prisma.$queryRawUnsafe(
      'SELECT MAX("numericId")::bigint AS max FROM "Room"'
    );

    const userMax = toBigInt(userMaxRows?.[0]?.max);
    const roomMax = toBigInt(roomMaxRows?.[0]?.max);

    const userNext = userMax + 1n;
    const roomNext = roomMax + 1n;

    const userTarget = userNext > USER_START ? userNext : USER_START;
    const roomTarget = roomNext > ROOM_START ? roomNext : ROOM_START;

    await prisma.$executeRawUnsafe(
      `SELECT setval('"User_numericId_seq"', ${userTarget}, false);`
    );
    await prisma.$executeRawUnsafe(
      `SELECT setval('"Room_numericId_seq"', ${roomTarget}, false);`
    );

    const userSeq = await prisma.$queryRawUnsafe(
      'SELECT last_value, is_called FROM "User_numericId_seq"'
    );
    const roomSeq = await prisma.$queryRawUnsafe(
      'SELECT last_value, is_called FROM "Room_numericId_seq"'
    );

    console.log('\n✅ Sequences updated');
    console.log('User max:', userMax.toString(), '-> next:', userTarget.toString());
    console.log('Room max:', roomMax.toString(), '-> next:', roomTarget.toString());
    console.log('User sequence:', userSeq);
    console.log('Room sequence:', roomSeq);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('❌ Failed to update sequences:', error);
  process.exit(1);
});
