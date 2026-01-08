/**
 * 🎁 محاكاة إرسال الهدايا عبر API
 * هذا السكريبت يرسل الهدايا عبر API للحصول على WebSocket events
 */

import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();
const API_URL = 'http://167.235.64.220:3000';

const giftIds = ['rose', 'heart', 'clap', 'gold_ring', 'trophy', 'lion'];

async function login(email: string, password: string): Promise<string | null> {
  try {
    const response = await axios.post(`${API_URL}/auth/login`, { email, password });
    return response.data.tokens?.accessToken || null;
  } catch (e) {
    return null;
  }
}

async function sendGift(
  token: string,
  roomId: string,
  recipientId: string,
  giftId: string,
  count: number = 1
): Promise<boolean> {
  try {
    await axios.post(`${API_URL}/gifts/send`, 
      { roomId, recipientId, giftId, count },
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    return true;
  } catch (e: any) {
    console.log(`     ❌ خطأ في إرسال الهدية: ${e.response?.data?.message || e.message}`);
    return false;
  }
}

async function main() {
  console.log('🎭 محاكاة إرسال الهدايا عبر API...\n');
  
  // جلب المستخدمين المنشأين عبر seed (ahmed@test.com, sara@test.com, etc.)
  const users = await prisma.user.findMany({
    where: { 
      email: { in: ['ahmed@test.com', 'sara@test.com', 'ali@test.com', 'fatima@test.com', 'nour@test.com'] }
    },
    include: { wallet: true },
    take: 5,
  });
  
  if (users.length < 2) {
    console.log('❌ لا يوجد مستخدمين كافيين. تأكد من إنشاء المستخدمين عبر create-api-users.mjs');
    
    // محاولة إنشاء رصيد للمستخدمين الموجودين
    const existingUsers = await prisma.user.findMany({
      where: { email: { endsWith: '@test.com' } },
      take: 5
    });
    
    console.log(`وجدت ${existingUsers.length} مستخدمين`);
    await prisma.$disconnect();
    return;
  }
  
  // إعادة جلب المستخدمين
  const testUsers = await prisma.user.findMany({
    where: { email: { endsWith: '@test.com' } },
    include: { wallet: true },
    take: 5,
  });
  
  // جلب أول غرفة متاحة
  const room = await prisma.room.findFirst({
    orderBy: { currentMembers: 'desc' }
  });
  
  if (!room) {
    console.log('❌ لا توجد غرف');
    await prisma.$disconnect();
    return;
  }
  
  console.log(`📍 الغرفة: ${room.name}\n`);
  
  // تسجيل دخول المستخدمين وإرسال الهدايا
  console.log('🔐 تسجيل دخول المستخدمين...\n');
  
  const userTokens: { user: any, token: string }[] = [];
  
  for (const user of testUsers) {
    const token = await login(user.email, 'Test@123');
    if (token) {
      userTokens.push({ user, token });
      console.log(`  ✅ ${user.displayName} - تم التسجيل`);
    } else {
      console.log(`  ❌ ${user.displayName} - فشل التسجيل`);
    }
  }
  
  if (userTokens.length < 2) {
    console.log('\n❌ لا يوجد مستخدمين مسجلين كافيين');
    await prisma.$disconnect();
    return;
  }
  
  console.log('\n🎁 إرسال الهدايا:\n');
  
  // إرسال 5 هدايا
  for (let i = 0; i < 5; i++) {
    const senderIdx = i % userTokens.length;
    let receiverIdx = (i + 1) % userTokens.length;
    
    const { user: sender, token } = userTokens[senderIdx];
    const { user: receiver } = userTokens[receiverIdx];
    const giftId = giftIds[i % giftIds.length];
    
    console.log(`  🎁 ${sender.displayName} ➜ ${receiver.displayName} (${giftId})`);
    
    const success = await sendGift(token, room.id, receiver.id, giftId, 1);
    
    if (success) {
      console.log(`     ✅ تم الإرسال بنجاح!`);
    } else {
      console.log(`     ❌ فشل الإرسال`);
    }
    
    // انتظار 2 ثانية بين الهدايا
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n✨ انتهت المحاكاة!');
  await prisma.$disconnect();
}

main().catch(console.error);
