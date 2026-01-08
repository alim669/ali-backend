const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n✅ CREATED TRIGGERS:');
  console.log('─'.repeat(50));
  
  const triggers = await prisma.$queryRaw`
    SELECT 
      trigger_name,
      event_object_table AS table_name,
      action_timing || ' ' || event_manipulation AS event
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
      AND trigger_name LIKE 'trg_%_updated_at'
    ORDER BY event_object_table
  `;
  
  triggers.forEach(t => {
    console.log(`   ✓ ${t.table_name} → ${t.trigger_name}`);
  });
  
  console.log('\n📊 Total triggers created:', triggers.length);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
