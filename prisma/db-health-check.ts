import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface TableStats {
  table_name: string;
  row_count: bigint;
  table_size: string;
  index_size: string;
  total_size: string;
}

interface IndexStats {
  table_name: string;
  index_name: string;
  index_size: string;
  number_of_scans: bigint;
  tuples_read: bigint;
  tuples_fetched: bigint;
}

interface SlowQuery {
  query: string;
  calls: bigint;
  total_time: number;
  mean_time: number;
}

async function main() {
  console.log('🔍 === فحص صحة قاعدة البيانات ===\n');

  try {
    // 1. Test Connection
    console.log('1️⃣ اختبار الاتصال...');
    const connectionTest = await prisma.$queryRaw<[{ version: string }]>`SELECT version()`;
    console.log('   ✅ متصل بـ:', connectionTest[0].version.split(',')[0]);

    // 2. Database Size
    console.log('\n2️⃣ حجم قاعدة البيانات...');
    const dbSize = await prisma.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    console.log('   📊 الحجم الإجمالي:', dbSize[0].size);

    // 3. Table Statistics
    console.log('\n3️⃣ إحصائيات الجداول...');
    const tableStats = await prisma.$queryRaw<TableStats[]>`
      SELECT 
        schemaname || '.' || relname as table_name,
        n_live_tup as row_count,
        pg_size_pretty(pg_relation_size(relid)) as table_size,
        pg_size_pretty(pg_indexes_size(relid)) as index_size,
        pg_size_pretty(pg_total_relation_size(relid)) as total_size
      FROM pg_stat_user_tables
      ORDER BY pg_total_relation_size(relid) DESC
      LIMIT 15
    `;

    console.log('   ┌─────────────────────────────┬──────────┬───────────┬───────────┬───────────┐');
    console.log('   │ الجدول                      │ الصفوف   │ البيانات  │ الفهارس   │ الإجمالي  │');
    console.log('   ├─────────────────────────────┼──────────┼───────────┼───────────┼───────────┤');
    for (const table of tableStats) {
      const name = table.table_name.padEnd(27);
      const rows = String(table.row_count).padStart(8);
      const tSize = table.table_size.padStart(9);
      const iSize = table.index_size.padStart(9);
      const total = table.total_size.padStart(9);
      console.log(`   │ ${name} │ ${rows} │ ${tSize} │ ${iSize} │ ${total} │`);
    }
    console.log('   └─────────────────────────────┴──────────┴───────────┴───────────┴───────────┘');

    // 4. Check for Missing Indexes
    console.log('\n4️⃣ فحص الفهارس المفقودة...');
    const missingIndexes = await prisma.$queryRaw<any[]>`
      SELECT 
        schemaname || '.' || relname as table_name,
        seq_scan,
        seq_tup_read,
        idx_scan,
        CASE WHEN seq_scan > 0 
          THEN round(100.0 * idx_scan / (seq_scan + idx_scan), 2) 
          ELSE 100 
        END as idx_scan_pct
      FROM pg_stat_user_tables
      WHERE seq_scan > idx_scan
        AND n_live_tup > 1000
      ORDER BY seq_tup_read DESC
      LIMIT 10
    `;

    if (missingIndexes.length > 0) {
      console.log('   ⚠️ جداول تحتاج فهارس إضافية:');
      for (const idx of missingIndexes) {
        console.log(`      - ${idx.table_name}: ${idx.seq_scan} full scans vs ${idx.idx_scan} index scans (${idx.idx_scan_pct}% indexed)`);
      }
    } else {
      console.log('   ✅ جميع الجداول محسنة بالفهارس');
    }

    // 5. Index Usage Statistics
    console.log('\n5️⃣ استخدام الفهارس...');
    const indexUsage = await prisma.$queryRaw<IndexStats[]>`
      SELECT
        schemaname || '.' || relname as table_name,
        indexrelname as index_name,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
        idx_scan as number_of_scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched
      FROM pg_stat_user_indexes
      ORDER BY idx_scan DESC
      LIMIT 10
    `;

    console.log('   أكثر الفهارس استخداماً:');
    for (const idx of indexUsage) {
      console.log(`      ✓ ${idx.index_name}: ${idx.number_of_scans} scans`);
    }

    // 6. Unused Indexes (potential for removal)
    console.log('\n6️⃣ فهارس غير مستخدمة (قد يمكن إزالتها)...');
    const unusedIndexes = await prisma.$queryRaw<any[]>`
      SELECT
        schemaname || '.' || relname as table_name,
        indexrelname as index_name,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
        idx_scan as number_of_scans
      FROM pg_stat_user_indexes
      WHERE idx_scan = 0
        AND indexrelname NOT LIKE '%_pkey'
        AND indexrelname NOT LIKE '%_key'
      ORDER BY pg_relation_size(indexrelid) DESC
      LIMIT 10
    `;

    if (unusedIndexes.length > 0) {
      console.log('   ⚠️ فهارس لم تُستخدم:');
      for (const idx of unusedIndexes) {
        console.log(`      - ${idx.index_name} (${idx.index_size})`);
      }
    } else {
      console.log('   ✅ جميع الفهارس مستخدمة');
    }

    // 7. Check for Bloat (dead tuples)
    console.log('\n7️⃣ فحص البيانات الميتة (Bloat)...');
    const bloatInfo = await prisma.$queryRaw<any[]>`
      SELECT 
        schemaname || '.' || relname as table_name,
        n_dead_tup as dead_tuples,
        n_live_tup as live_tuples,
        CASE WHEN n_live_tup > 0 
          THEN round(100.0 * n_dead_tup / n_live_tup, 2)
          ELSE 0 
        END as dead_ratio,
        last_vacuum,
        last_autovacuum,
        last_analyze
      FROM pg_stat_user_tables
      WHERE n_dead_tup > 100
      ORDER BY n_dead_tup DESC
      LIMIT 10
    `;

    if (bloatInfo.length > 0) {
      console.log('   جداول بها بيانات ميتة:');
      for (const table of bloatInfo) {
        console.log(`      - ${table.table_name}: ${table.dead_tuples} dead rows (${table.dead_ratio}%)`);
      }
    } else {
      console.log('   ✅ لا توجد بيانات ميتة ملحوظة');
    }

    // 8. Connection Statistics
    console.log('\n8️⃣ إحصائيات الاتصالات...');
    const connStats = await prisma.$queryRaw<any[]>`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active,
        count(*) FILTER (WHERE state = 'idle') as idle,
        count(*) FILTER (WHERE state = 'idle in transaction') as idle_in_transaction,
        max(extract(epoch from (now() - query_start)))::int as longest_query_seconds
      FROM pg_stat_activity
      WHERE datname = current_database()
    `;

    const conn = connStats[0];
    console.log(`   📡 الاتصالات الكلية: ${conn.total_connections}`);
    console.log(`      - نشطة: ${conn.active}`);
    console.log(`      - خاملة: ${conn.idle}`);
    console.log(`      - في معاملة خاملة: ${conn.idle_in_transaction}`);
    console.log(`      - أطول استعلام: ${conn.longest_query_seconds || 0} ثانية`);

    // 9. Cache Hit Ratio
    console.log('\n9️⃣ نسبة الإصابة في الذاكرة المؤقتة...');
    const cacheRatio = await prisma.$queryRaw<any[]>`
      SELECT 
        round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) as table_hit_ratio,
        round(100.0 * sum(idx_blks_hit) / nullif(sum(idx_blks_hit) + sum(idx_blks_read), 0), 2) as index_hit_ratio
      FROM pg_statio_user_tables
    `;

    const cache = cacheRatio[0];
    console.log(`   💾 نسبة cache للجداول: ${cache.table_hit_ratio || 'N/A'}%`);
    console.log(`   💾 نسبة cache للفهارس: ${cache.index_hit_ratio || 'N/A'}%`);

    if (Number(cache.table_hit_ratio) >= 99) {
      console.log('   ✅ أداء الذاكرة المؤقتة ممتاز!');
    } else if (Number(cache.table_hit_ratio) >= 95) {
      console.log('   ✅ أداء الذاكرة المؤقتة جيد');
    } else {
      console.log('   ⚠️ قد تحتاج لزيادة shared_buffers');
    }

    // 10. Row Counts Summary
    console.log('\n🔟 ملخص عدد الصفوف...');
    const userCount = await prisma.user.count();
    const roomCount = await prisma.room.count();
    const messageCount = await prisma.message.count();
    const giftCount = await prisma.gift.count();
    const giftSendCount = await prisma.giftSend.count();
    const walletCount = await prisma.wallet.count();
    const notificationCount = await prisma.notification.count();
    const privateMessageCount = await prisma.privateMessage.count();

    console.log(`   👤 المستخدمين: ${userCount}`);
    console.log(`   🏠 الغرف: ${roomCount}`);
    console.log(`   💬 الرسائل: ${messageCount}`);
    console.log(`   🎁 الهدايا: ${giftCount}`);
    console.log(`   📦 الهدايا المرسلة: ${giftSendCount}`);
    console.log(`   💰 المحافظ: ${walletCount}`);
    console.log(`   🔔 الإشعارات: ${notificationCount}`);
    console.log(`   ✉️ الرسائل الخاصة: ${privateMessageCount}`);

    console.log('\n✅ === اكتمل فحص قاعدة البيانات ===\n');

  } catch (error) {
    console.error('❌ خطأ:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
