// سكريبت محاكاة إرسال الهدايا بين المستخدمين
const API_URL = 'http://167.235.64.220:3000/api/v1';

const users = [
  { email: 'ahmed2@test.com', password: 'Test@123' },
  { email: 'sara2@test.com', password: 'Test@123' },
  { email: 'ali2@test.com', password: 'Test@123' },
  { email: 'fatima2@test.com', password: 'Test@123' },
  { email: 'nour2@test.com', password: 'Test@123' },
];

// الهدايا المتوفرة
const gifts = ['rose', 'heart', 'clap', 'gold_ring', 'trophy', 'lion'];

async function login(email, password) {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  return data.tokens?.accessToken;
}

async function sendGift(token, receiverId, giftId, roomId) {
  const response = await fetch(`${API_URL}/gifts/send`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      receiverId,
      giftId,
      roomId,
      quantity: 1,
    }),
  });
  return response.json();
}

async function getMyProfile(token) {
  const response = await fetch(`${API_URL}/users/me`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return response.json();
}

async function getRooms(token) {
  const response = await fetch(`${API_URL}/rooms`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return response.json();
}

async function joinRoom(token, roomId) {
  const response = await fetch(`${API_URL}/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
  });
  return response.json();
}

async function main() {
  console.log('🎭 بدء محاكاة إرسال الهدايا...\n');
  
  // تسجيل دخول جميع المستخدمين
  console.log('🔐 تسجيل دخول المستخدمين...');
  const loggedInUsers = [];
  
  for (const user of users) {
    const token = await login(user.email, user.password);
    if (token) {
      const profile = await getMyProfile(token);
      loggedInUsers.push({
        email: user.email,
        token,
        id: profile.id,
        displayName: profile.displayName,
      });
      console.log(`  ✅ ${profile.displayName} دخل`);
    } else {
      console.log(`  ❌ فشل دخول ${user.email}`);
    }
  }
  
  if (loggedInUsers.length < 2) {
    console.log('❌ لا يوجد مستخدمين كافيين');
    return;
  }
  
  // الحصول على الغرف
  console.log('\n🏠 البحث عن غرفة...');
  const roomsData = await getRooms(loggedInUsers[0].token);
  const rooms = roomsData.rooms || roomsData.data || [];
  
  if (rooms.length === 0) {
    console.log('❌ لا توجد غرف متاحة');
    return;
  }
  
  const room = rooms[0];
  console.log(`  📍 الغرفة: ${room.name} (${room.id})`);
  
  // دخول الغرفة
  console.log('\n🚪 دخول المستخدمين للغرفة...');
  for (const user of loggedInUsers) {
    await joinRoom(user.token, room.id);
    console.log(`  ✅ ${user.displayName} دخل الغرفة`);
  }
  
  // إرسال الهدايا
  console.log('\n🎁 إرسال الهدايا...\n');
  
  for (let i = 0; i < 10; i++) {
    const senderIdx = Math.floor(Math.random() * loggedInUsers.length);
    let receiverIdx = Math.floor(Math.random() * loggedInUsers.length);
    while (receiverIdx === senderIdx) {
      receiverIdx = Math.floor(Math.random() * loggedInUsers.length);
    }
    
    const sender = loggedInUsers[senderIdx];
    const receiver = loggedInUsers[receiverIdx];
    const giftId = gifts[Math.floor(Math.random() * gifts.length)];
    
    console.log(`  🎁 ${sender.displayName} ➜ ${receiver.displayName} (${giftId})`);
    
    const result = await sendGift(sender.token, receiver.id, giftId, room.id);
    
    if (result.error || result.statusCode >= 400) {
      console.log(`     ⚠️ ${result.message || 'فشل الإرسال'}`);
    } else {
      console.log(`     ✅ تم الإرسال!`);
    }
    
    // انتظار 2 ثانية بين كل هدية
    await new Promise(r => setTimeout(r, 2000));
  }
  
  console.log('\n✨ انتهت المحاكاة!');
}

main().catch(console.error);
