// سكريبت إنشاء مستخدمين تجريبيين عبر API
// يجب تشغيله بـ Node.js

const testUsers = [
  { email: 'ahmed2@test.com', username: 'ahmed2_test', displayName: 'أحمد محمد', password: 'Test@123' },
  { email: 'sara2@test.com', username: 'sara2_test', displayName: 'سارة أحمد', password: 'Test@123' },
  { email: 'ali2@test.com', username: 'ali2_test', displayName: 'علي حسين', password: 'Test@123' },
  { email: 'fatima2@test.com', username: 'fatima2_test', displayName: 'فاطمة علي', password: 'Test@123' },
  { email: 'nour2@test.com', username: 'nour2_test', displayName: 'نور الهدى', password: 'Test@123' },
];

const API_URL = 'http://167.235.64.220:3000/api/v1';

async function createUsers() {
  console.log('👥 إنشاء مستخدمين تجريبيين عبر API...\n');
  
  for (const user of testUsers) {
    try {
      const response = await fetch(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user),
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log(`✅ ${user.displayName} - ${user.email}`);
      } else {
        console.log(`⚠️ ${user.displayName}: ${data.message || 'فشل'}`);
      }
    } catch (error) {
      console.log(`❌ ${user.displayName}: ${error.message}`);
    }
  }
  
  console.log('\n📧 كلمة المرور لجميع المستخدمين: Test@123');
}

createUsers();
