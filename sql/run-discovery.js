const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║           DATABASE DISCOVERY ANALYSIS                          ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // 1. Database Info
  console.log('📊 DATABASE INFO:');
  console.log('─'.repeat(50));
  const dbInfo = await prisma.$queryRaw`
    SELECT 
      current_database() AS database_name,
      current_user AS connected_user,
      pg_size_pretty(pg_database_size(current_database())) AS total_size,
      (SELECT COUNT(*) FROM pg_stat_activity WHERE datname = current_database()) AS active_connections
  `;
  console.table(dbInfo);

  // 2. Tables Overview
  console.log('\n📋 TABLES OVERVIEW:');
  console.log('─'.repeat(50));
  const tables = await prisma.$queryRaw`
    SELECT 
      c.relname AS table_name,
      pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
      s.n_live_tup AS estimated_rows,
      s.n_dead_tup AS dead_tuples
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY pg_total_relation_size(c.oid) DESC
  `;
  console.table(tables.map(t => ({
    table: t.table_name,
    size: t.total_size,
    rows: Number(t.estimated_rows || 0),
    dead: Number(t.dead_tuples || 0)
  })));

  // 3. Naming Convention Detection
  console.log('\n🔤 NAMING CONVENTION DETECTION:');
  console.log('─'.repeat(50));
  const naming = await prisma.$queryRaw`
    SELECT 
      CASE 
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'createdAt') 
        THEN 'camelCase (Prisma)'
        WHEN EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'created_at') 
        THEN 'snake_case'
        ELSE 'unknown'
      END AS detected_convention
  `;
  console.log('   Detected:', naming[0].detected_convention);

  // 4. Tables with updatedAt column (for triggers)
  console.log('\n⏰ TABLES WITH UPDATEDAT (Need Trigger):');
  console.log('─'.repeat(50));
  const updatedAtTables = await prisma.$queryRaw`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND column_name IN ('updatedAt', 'updated_at')
    ORDER BY table_name
  `;
  updatedAtTables.forEach(t => {
    console.log(`   ✓ ${t.table_name} (${t.column_name})`);
  });

  // 5. Existing Indexes
  console.log('\n🔍 EXISTING INDEXES:');
  console.log('─'.repeat(50));
  const indexes = await prisma.$queryRaw`
    SELECT 
      pg_indexes.tablename AS table_name,
      pg_indexes.indexname AS index_name,
      pg_size_pretty(pg_relation_size(i.indexrelid)) AS size,
      i.idx_scan AS used
    FROM pg_indexes
    JOIN pg_stat_user_indexes i ON i.indexrelname = pg_indexes.indexname 
      AND i.schemaname = pg_indexes.schemaname
    WHERE pg_indexes.schemaname = 'public'
    ORDER BY pg_indexes.tablename, pg_indexes.indexname
  `;
  console.table(indexes.map(idx => ({
    table: idx.table_name,
    index: idx.index_name,
    size: idx.size,
    used: Number(idx.used)
  })));

  // 6. Unused Indexes
  console.log('\n⚠️  UNUSED INDEXES (Consider Removing):');
  console.log('─'.repeat(50));
  const unusedIndexes = await prisma.$queryRaw`
    SELECT 
      relname AS table_name,
      indexrelname AS index_name,
      idx_scan AS times_used,
      pg_size_pretty(pg_relation_size(indexrelid)) AS size
    FROM pg_stat_user_indexes
    WHERE schemaname = 'public'
      AND idx_scan = 0
      AND indexrelname NOT LIKE '%_pkey'
    ORDER BY pg_relation_size(indexrelid) DESC
  `;
  if (unusedIndexes.length === 0) {
    console.log('   ✓ No unused indexes found!');
  } else {
    console.table(unusedIndexes);
  }

  // 7. Foreign Keys
  console.log('\n🔗 FOREIGN KEY RELATIONSHIPS:');
  console.log('─'.repeat(50));
  const fks = await prisma.$queryRaw`
    SELECT
      tc.table_name AS from_table,
      kcu.column_name AS fk_column,
      ccu.table_name AS to_table,
      ccu.column_name AS to_column
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
    ORDER BY tc.table_name
  `;
  console.table(fks.map(fk => ({
    from: `${fk.from_table}.${fk.fk_column}`,
    to: `${fk.to_table}.${fk.to_column}`
  })));

  // 8. Check for Orphan Records
  console.log('\n🔎 CHECKING FOR ORPHAN RECORDS:');
  console.log('─'.repeat(50));
  
  // Check RoomMember orphans
  const roomMemberOrphans = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "RoomMember" rm
    WHERE NOT EXISTS (SELECT 1 FROM "Room" r WHERE r.id = rm."roomId")
  `;
  console.log(`   RoomMember without Room: ${roomMemberOrphans[0].count}`);

  const messageOrphans = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Message" m
    WHERE NOT EXISTS (SELECT 1 FROM "Room" r WHERE r.id = m."roomId")
  `;
  console.log(`   Message without Room: ${messageOrphans[0].count}`);

  const walletOrphans = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "Wallet" w
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = w."userId")
  `;
  console.log(`   Wallet without User: ${walletOrphans[0].count}`);

  const giftSendOrphans = await prisma.$queryRaw`
    SELECT COUNT(*) as count FROM "GiftSend" gs
    WHERE NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = gs."senderId")
       OR NOT EXISTS (SELECT 1 FROM "User" u WHERE u.id = gs."receiverId")
  `;
  console.log(`   GiftSend without Sender/Receiver: ${giftSendOrphans[0].count}`);

  // 9. Missing Indexes Recommendation
  console.log('\n💡 RECOMMENDED INDEXES (Not Yet Created):');
  console.log('─'.repeat(50));
  const missingIndexes = [
    { table: 'Message', columns: 'roomId, createdAt DESC', reason: 'Chat room queries' },
    { table: 'RoomMember', columns: 'roomId, userId', reason: 'Member lookup' },
    { table: 'GiftSend', columns: 'receiverId, createdAt DESC', reason: 'Gift history' },
    { table: 'WalletTransaction', columns: 'walletId, createdAt DESC', reason: 'Transaction history' },
    { table: 'Follow', columns: 'followerId / followingId', reason: 'Follow queries' },
    { table: 'Notification', columns: 'userId, isRead, createdAt', reason: 'Unread notifications' }
  ];
  
  for (const idx of missingIndexes) {
    const exists = indexes.some(i => 
      i.table_name === idx.table && 
      !i.index_name.endsWith('_pkey')
    );
    const status = exists ? '✓' : '⚠️';
    console.log(`   ${status} ${idx.table}(${idx.columns}) - ${idx.reason}`);
  }

  // 10. Summary
  console.log('\n' + '═'.repeat(60));
  console.log('📈 SUMMARY:');
  console.log('═'.repeat(60));
  console.log(`   Total Tables: ${tables.length}`);
  console.log(`   Total Indexes: ${indexes.length}`);
  console.log(`   Unused Indexes: ${unusedIndexes.length}`);
  console.log(`   Tables needing updatedAt trigger: ${updatedAtTables.length}`);
  console.log(`   Foreign Key Relations: ${fks.length}`);
  console.log('═'.repeat(60));
  console.log('\n✅ Discovery Complete! Review the output above.\n');
}

main()
  .catch(e => {
    console.error('Error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
