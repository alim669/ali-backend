/**
 * Test Firebase Push Notification
 * اختبار إرسال إشعار عبر Firebase HTTP v1
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// قراءة Service Account
const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));

console.log('📱 Firebase Push Notification Test');
console.log('==================================');
console.log(`Project ID: ${serviceAccount.project_id}`);
console.log(`Client Email: ${serviceAccount.client_email}`);

// إنشاء JWT
function createJWT(header, payload, privateKey) {
  const base64Header = Buffer.from(JSON.stringify(header)).toString('base64url');
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signatureInput = `${base64Header}.${base64Payload}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signatureInput);
  const signature = sign.sign(privateKey, 'base64url');

  return `${signatureInput}.${signature}`;
}

// الحصول على Access Token
async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600;

  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: expiry,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
  };

  const jwt = createJWT(header, payload, serviceAccount.private_key);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  const data = await response.json();
  
  if (data.access_token) {
    console.log('✅ Access Token obtained successfully!');
    console.log(`   Token expires in: ${data.expires_in} seconds`);
    return data.access_token;
  } else {
    console.log('❌ Failed to get access token:', data);
    return null;
  }
}

// اختبار الاتصال بـ FCM
async function testFCMConnection() {
  console.log('\n🔄 Testing Firebase connection...');
  
  const accessToken = await getAccessToken();
  if (!accessToken) {
    console.log('❌ Cannot proceed without access token');
    return;
  }

  console.log('\n✅ Firebase HTTP v1 API is ready!');
  console.log('\n📋 Summary:');
  console.log('   - Service Account: Valid');
  console.log('   - OAuth 2.0: Working');
  console.log('   - FCM API: Ready to send notifications');
  
  console.log('\n💡 To send a real notification, you need a valid FCM device token.');
  console.log('   Device tokens are obtained from the Flutter app after user login.');
}

// تشغيل الاختبار
testFCMConnection().catch(console.error);
