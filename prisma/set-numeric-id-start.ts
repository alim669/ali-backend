/**
 * Script لتعيين بداية numericId إلى 100 مليون
 * يُشغّل مرة واحدة بعد تطبيق الـ migration
 * 
 * الاستخدام: npx ts-node prisma/set-numeric-id-start.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 تعيين بداية numericId إلى 100 مليون...');
  
  try {
    // تعيين قيمة الـ sequence إلى 100 مليون
    await prisma.$executeRawUnsafe(`
      ALTER SEQUENCE "User_numericId_seq" RESTART WITH 100000000
    `);
    
    console.log('✅ تم تعيين بداية numericId إلى 100,000,000');
    
    // التحقق من القيمة
    const result = await prisma.$queryRawUnsafe(`
      SELECT last_value FROM "User_numericId_seq"
    `) as any[];
    
    console.log('📊 القيمة الحالية للـ sequence:', result[0]?.last_value);
    
  } catch (error: any) {
    // إذا كان الـ sequence غير موجود، قد يكون الاسم مختلف
    if (error.message.includes('does not exist')) {
      console.log('⚠️ اسم الـ sequence مختلف، جاري البحث...');
      
      // البحث عن اسم الـ sequence الصحيح
      const sequences = await prisma.$queryRawUnsafe(`
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_name LIKE '%numericId%' OR sequence_name LIKE '%numeric_id%'
      `) as any[];
      
      if (sequences.length > 0) {
        const seqName = sequences[0].sequence_name;
        console.log('📍 وجدت sequence:', seqName);
        
        await prisma.$executeRawUnsafe(`
          ALTER SEQUENCE "${seqName}" RESTART WITH 100000000
        `);
        
        console.log('✅ تم تعيين بداية numericId إلى 100,000,000');
      } else {
        console.error('❌ لم يتم العثور على sequence للـ numericId');
      }
    } else {
      throw error;
    }
  }
}

main()
  .catch((e) => {
    console.error('❌ خطأ:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
