/**
 * Script لتعيين بداية numericId للمستخدمين الجدد إلى 1682805400
 * يُشغّل مرة واحدة على السيرفر بعد التحديث
 * 
 * الاستخدام: npx ts-node prisma/set-numeric-id-1682805400.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const NEW_START_VALUE = 1682805400;

async function main() {
  console.log(`🔧 تعيين بداية numericId للمستخدمين الجدد إلى ${NEW_START_VALUE}...`);
  
  try {
    // 1. الحصول على أعلى numericId حالي
    const result = await prisma.$queryRawUnsafe(`
      SELECT MAX("numericId") as max_id FROM "User"
    `) as any[];
    
    const currentMax = result[0]?.max_id ? BigInt(result[0].max_id) : BigInt(0);
    console.log(`📊 أعلى numericId حالي: ${currentMax}`);
    
    // 2. التحقق من أن القيمة الجديدة أكبر من القيمة الحالية
    if (currentMax >= BigInt(NEW_START_VALUE)) {
      console.log(`⚠️ تحذير: أعلى ID حالي (${currentMax}) أكبر من أو يساوي القيمة الجديدة (${NEW_START_VALUE})`);
      console.log(`📝 سيتم تعيين القيمة إلى ${currentMax + BigInt(1)} بدلاً من ذلك`);
      
      await prisma.$executeRawUnsafe(`
        ALTER SEQUENCE "User_numericId_seq" RESTART WITH ${currentMax + BigInt(1)}
      `);
      
      console.log(`✅ تم تعيين بداية numericId إلى ${currentMax + BigInt(1)}`);
    } else {
      // 3. تعيين قيمة الـ sequence إلى القيمة الجديدة
      await prisma.$executeRawUnsafe(`
        ALTER SEQUENCE "User_numericId_seq" RESTART WITH ${NEW_START_VALUE}
      `);
      
      console.log(`✅ تم تعيين بداية numericId إلى ${NEW_START_VALUE}`);
    }
    
    // 4. التحقق من القيمة الجديدة
    const verification = await prisma.$queryRawUnsafe(`
      SELECT last_value, is_called FROM "User_numericId_seq"
    `) as any[];
    
    console.log('📊 قيمة الـ sequence الحالية:', verification[0]?.last_value);
    console.log('📊 is_called:', verification[0]?.is_called);
    
    console.log('\n✅ تم بنجاح! المستخدمون الجدد سيحصلون على ID يبدأ من القيمة المحددة');
    
  } catch (error: any) {
    // إذا كان الـ sequence غير موجود، قد يكون الاسم مختلف
    if (error.message.includes('does not exist')) {
      console.log('⚠️ اسم الـ sequence مختلف، جاري البحث...');
      
      // البحث عن اسم الـ sequence الصحيح
      const sequences = await prisma.$queryRawUnsafe(`
        SELECT sequence_name 
        FROM information_schema.sequences 
        WHERE sequence_name LIKE '%numericId%' OR sequence_name LIKE '%User%'
      `) as any[];
      
      console.log('📍 الـ sequences الموجودة:', sequences.map((s: any) => s.sequence_name));
      
      if (sequences.length > 0) {
        // البحث عن الـ sequence الخاص بـ User
        const userSeq = sequences.find((s: any) => 
          s.sequence_name.includes('User') && s.sequence_name.includes('numericId')
        );
        
        if (userSeq) {
          const seqName = userSeq.sequence_name;
          console.log('📍 استخدام sequence:', seqName);
          
          await prisma.$executeRawUnsafe(`
            ALTER SEQUENCE "${seqName}" RESTART WITH ${NEW_START_VALUE}
          `);
          
          console.log(`✅ تم تعيين بداية numericId إلى ${NEW_START_VALUE}`);
        } else {
          console.error('❌ لم يتم العثور على sequence للـ User numericId');
        }
      } else {
        console.error('❌ لم يتم العثور على أي sequence');
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
