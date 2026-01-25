const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function deleteAllGifts() {
  try {
    console.log('🗑️ Starting gift deletion...');
    
    // First, check if there are any gift sends
    const sendCount = await prisma.giftSend.count();
    console.log(`Found ${sendCount} gift sends`);
    
    if (sendCount > 0) {
      // Delete gift sends first (foreign key constraint)
      await prisma.giftSend.deleteMany({});
      console.log('✅ Deleted all gift sends');
    }
    
    // Now delete all gifts
    const giftCount = await prisma.gift.count();
    console.log(`Found ${giftCount} gifts to delete`);
    
    if (giftCount > 0) {
      await prisma.gift.deleteMany({});
      console.log('✅ Deleted all gifts');
    }
    
    // Verify deletion
    const remainingGifts = await prisma.gift.count();
    const remainingSends = await prisma.giftSend.count();
    
    console.log('\n📊 Verification:');
    console.log(`  Remaining gifts: ${remainingGifts}`);
    console.log(`  Remaining gift sends: ${remainingSends}`);
    
    if (remainingGifts === 0 && remainingSends === 0) {
      console.log('\n🎉 All gifts and gift sends have been successfully deleted!');
    }
    
  } catch (error) {
    console.error('❌ Error deleting gifts:', error);
  } finally {
    await prisma.$disconnect();
  }
}

deleteAllGifts();
