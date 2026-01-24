const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  // Get ALL rooms without filter
  const rooms = await prisma.$queryRaw`SELECT id, "numericId", name, "createdAt" FROM "Room" ORDER BY "createdAt" DESC`;
  
  console.log('=== ALL Rooms (raw query) ===');
  console.log(`Total rooms: ${rooms.length}`);
  console.log('');
  rooms.forEach(room => {
    console.log(`ID: ${room.id}`);
    console.log(`  numericId: ${room.numericId}`);
    console.log(`  name: ${room.name}`);
    console.log('---');
  });
  
  // Check sequence value
  const seqResult = await prisma.$queryRaw`SELECT last_value, is_called FROM "Room_numericId_seq"`;
  console.log('');
  console.log('=== Sequence Info ===');
  console.log('Sequence:', seqResult);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
