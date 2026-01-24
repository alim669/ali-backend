import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function optimizeDatabase() {
  console.log('🔧 === تحسين قاعدة البيانات ===\n');

  try {
    // 1. Run VACUUM ANALYZE on all tables
    console.log('1️⃣ تنظيف وتحليل الجداول (VACUUM ANALYZE)...');
    await prisma.$executeRawUnsafe('VACUUM ANALYZE');
    console.log('   ✅ تم التنظيف والتحليل بنجاح');

    // 2. Reindex critical tables
    console.log('\n2️⃣ إعادة بناء الفهارس الحيوية...');
    const criticalTables = ['User', 'Room', 'Message', 'GiftSend', 'Wallet'];
    
    for (const table of criticalTables) {
      try {
        await prisma.$executeRawUnsafe(`REINDEX TABLE "${table}"`);
        console.log(`   ✅ أعيد فهرسة جدول ${table}`);
      } catch (e: any) {
        console.log(`   ⚠️ لم يمكن إعادة فهرسة ${table}: ${e.message}`);
      }
    }

    // 3. Update table statistics
    console.log('\n3️⃣ تحديث إحصائيات الجداول...');
    await prisma.$executeRawUnsafe('ANALYZE');
    console.log('   ✅ تم تحديث الإحصائيات');

    // 4. Check and suggest optimal settings
    console.log('\n4️⃣ إعدادات PostgreSQL الحالية...');
    
    const settings = await prisma.$queryRaw<any[]>`
      SELECT name, setting, unit, short_desc 
      FROM pg_settings 
      WHERE name IN (
        'shared_buffers', 
        'effective_cache_size', 
        'work_mem', 
        'maintenance_work_mem',
        'max_connections',
        'random_page_cost',
        'effective_io_concurrency',
        'wal_buffers'
      )
      ORDER BY name
    `;

    console.log('   ┌────────────────────────┬─────────────┬─────────┐');
    console.log('   │ الإعداد                │ القيمة      │ الوحدة  │');
    console.log('   ├────────────────────────┼─────────────┼─────────┤');
    for (const s of settings) {
      const name = s.name.padEnd(22);
      const value = s.setting.padStart(11);
      const unit = (s.unit || '-').padStart(7);
      console.log(`   │ ${name} │ ${value} │ ${unit} │`);
    }
    console.log('   └────────────────────────┴─────────────┴─────────┘');

    // 5. Check for long-running queries
    console.log('\n5️⃣ فحص الاستعلامات الطويلة...');
    const longQueries = await prisma.$queryRaw<any[]>`
      SELECT 
        pid,
        now() - pg_stat_activity.query_start AS duration,
        query,
        state
      FROM pg_stat_activity
      WHERE (now() - pg_stat_activity.query_start) > interval '30 seconds'
        AND state != 'idle'
        AND query NOT ILIKE '%pg_stat_activity%'
    `;

    if (longQueries.length > 0) {
      console.log('   ⚠️ استعلامات طويلة قيد التشغيل:');
      for (const q of longQueries) {
        console.log(`      PID: ${q.pid}, Duration: ${q.duration}, Query: ${q.query.substring(0, 50)}...`);
      }
    } else {
      console.log('   ✅ لا توجد استعلامات طويلة');
    }

    // 6. Check for locks
    console.log('\n6️⃣ فحص الأقفال (Locks)...');
    const locks = await prisma.$queryRaw<any[]>`
      SELECT 
        pg_stat_activity.pid,
        pg_locks.locktype,
        pg_locks.mode,
        pg_locks.granted,
        pg_stat_activity.query
      FROM pg_locks
      JOIN pg_stat_activity ON pg_stat_activity.pid = pg_locks.pid
      WHERE pg_locks.granted = false
    `;

    if (locks.length > 0) {
      console.log('   ⚠️ أقفال في انتظار:');
      for (const l of locks) {
        console.log(`      PID: ${l.pid}, Type: ${l.locktype}, Mode: ${l.mode}`);
      }
    } else {
      console.log('   ✅ لا توجد أقفال معلقة');
    }

    // 7. Clean up expired refresh tokens
    console.log('\n7️⃣ تنظيف التوكنات المنتهية...');
    const deletedTokens = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lt: new Date()
        }
      }
    });
    console.log(`   🗑️ تم حذف ${deletedTokens.count} توكن منتهي`);

    // 8. Clean up old notifications (older than 30 days and read)
    console.log('\n8️⃣ تنظيف الإشعارات القديمة المقروءة...');
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const deletedNotifications = await prisma.notification.deleteMany({
      where: {
        isRead: true,
        createdAt: {
          lt: thirtyDaysAgo
        }
      }
    });
    console.log(`   🗑️ تم حذف ${deletedNotifications.count} إشعار قديم`);

    // 9. Check database fragmentation
    console.log('\n9️⃣ فحص تجزئة الجداول...');
    const fragmentation = await prisma.$queryRaw<any[]>`
      SELECT 
        schemaname || '.' || relname as table_name,
        pg_size_pretty(pg_relation_size(relid)) as table_size,
        COALESCE(n_dead_tup, 0) as dead_tuples,
        COALESCE(n_live_tup, 0) as live_tuples,
        CASE 
          WHEN n_live_tup > 0 THEN round(100.0 * n_dead_tup / NULLIF(n_live_tup, 0), 2)
          ELSE 0 
        END as fragmentation_pct
      FROM pg_stat_user_tables
      WHERE n_live_tup > 0
      ORDER BY n_dead_tup DESC
      LIMIT 10
    `;

    console.log('   حالة التجزئة:');
    let needsVacuumFull = false;
    for (const f of fragmentation) {
      const status = Number(f.fragmentation_pct) > 20 ? '⚠️' : '✅';
      console.log(`      ${status} ${f.table_name}: ${f.fragmentation_pct}% dead tuples`);
      if (Number(f.fragmentation_pct) > 30) needsVacuumFull = true;
    }

    if (needsVacuumFull) {
      console.log('\n   💡 توصية: بعض الجداول تحتاج VACUUM FULL');
    }

    // 10. Generate optimization recommendations
    console.log('\n🔟 توصيات التحسين:');
    
    const dbSize = await prisma.$queryRaw<[{ size: string }]>`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `;
    
    const recommendations: string[] = [];

    // Check cache hit ratio
    const cacheRatio = await prisma.$queryRaw<any[]>`
      SELECT 
        round(100.0 * sum(heap_blks_hit) / nullif(sum(heap_blks_hit) + sum(heap_blks_read), 0), 2) as ratio
      FROM pg_statio_user_tables
    `;
    
    if (Number(cacheRatio[0]?.ratio) < 95) {
      recommendations.push('📌 زيادة shared_buffers لتحسين الذاكرة المؤقتة');
    }

    // Check connection count
    const connCount = await prisma.$queryRaw<any[]>`
      SELECT count(*) as cnt FROM pg_stat_activity
    `;
    
    if (Number(connCount[0].cnt) > 50) {
      recommendations.push('📌 استخدام connection pooling مثل PgBouncer');
    }

    // Always good recommendations
    recommendations.push('📌 تشغيل VACUUM ANALYZE دورياً (يومياً أو أسبوعياً)');
    recommendations.push('📌 مراقبة slow_query_log للاستعلامات البطيئة');
    recommendations.push('📌 النسخ الاحتياطي الدوري لقاعدة البيانات');

    for (const rec of recommendations) {
      console.log(`   ${rec}`);
    }

    console.log('\n✅ === اكتمل تحسين قاعدة البيانات ===\n');

  } catch (error) {
    console.error('❌ خطأ:', error);
  } finally {
    await prisma.$disconnect();
  }
}

optimizeDatabase();
