/**
 * Script لتطبيق migration إضافة numericId للغرف
 * 
 * الاستخدام:
 * 1. cd ali/backend
 * 2. npx prisma migrate deploy
 * 3. npx prisma generate
 * 
 * أو يدوياً:
 * npx ts-node prisma/apply-room-numeric-id.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 تطبيق migration إضافة numericId للغرف...');
  
  try {
    // قراءة ملف الـ migration
    const migrationPath = path.join(__dirname, 'migrations', '20260112_add_room_numeric_id', 'migration.sql');
    
    if (!fs.existsSync(migrationPath)) {
      console.error('❌ ملف الـ migration غير موجود:', migrationPath);
      console.log('💡 استخدم: npx prisma migrate deploy');
      return;
    }

    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');
    
    // تقسيم الـ SQL إلى أوامر منفصلة
    const statements = migrationSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));
    
    console.log(`📝 سيتم تنفيذ ${statements.length} أمر SQL...`);
    
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (stmt.includes('DO $$')) {
        // Handle PL/pgSQL blocks specially
        const fullBlock = migrationSql.match(/DO \$\$[\s\S]*?END \$\$/)?.[0];
        if (fullBlock) {
          console.log(`  [${i + 1}] تنفيذ PL/pgSQL block...`);
          await prisma.$executeRawUnsafe(fullBlock);
        }
      } else if (!stmt.includes('END $$') && !stmt.includes('BEGIN') && !stmt.includes('DECLARE')) {
        console.log(`  [${i + 1}] ${stmt.substring(0, 50)}...`);
        try {
          await prisma.$executeRawUnsafe(stmt);
        } catch (e: any) {
          if (e.message.includes('already exists')) {
            console.log(`    ⏭️ تم تخطيه (موجود مسبقاً)`);
          } else {
            throw e;
          }
        }
      }
    }
    
    console.log('✅ تم تطبيق الـ migration بنجاح!');
    
    // التحقق من النتيجة
    const roomCount = await prisma.room.count();
    console.log(`📊 عدد الغرف: ${roomCount}`);
    
    if (roomCount > 0) {
      const rooms = await prisma.$queryRaw`SELECT id, "numericId", name FROM "Room" ORDER BY "numericId" ASC LIMIT 5` as any[];
      console.log('📋 أول 5 غرف:');
      rooms.forEach((r: any) => {
        console.log(`   - ${r.name} (numericId: ${r.numericId})`);
      });
    }
    
  } catch (error: any) {
    console.error('❌ خطأ:', error.message);
    throw error;
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
