const http = require('http');

// Login first
const loginData = JSON.stringify({
  email: 'sdad34461@gmail.com',
  password: 'Owner123456'
});

const loginOptions = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': loginData.length
  }
};

const loginReq = http.request(loginOptions, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const json = JSON.parse(body);
    
    if (json.success && json.data && json.data.tokens) {
      const token = json.data.tokens.accessToken;
      console.log('Got token, now testing pending requests...\n');
      
      // Now test pending requests
      const pendingOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/v1/friends/requests/pending',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      };
      
      const pendingReq = http.request(pendingOptions, (resPending) => {
        let pendingBody = '';
        resPending.on('data', (chunk) => pendingBody += chunk);
        resPending.on('end', () => {
          console.log('Pending Requests API Response:');
          console.log(pendingBody);
        });
      });
      
      pendingReq.on('error', (e) => {
        console.error('Error in pending request:', e.message);
      });
      
      pendingReq.end();
    } else {
      console.log('Login failed:', JSON.stringify(json, null, 2));
    }
  });
});

loginReq.on('error', (e) => {
  console.error('Error in login:', e.message);
});

loginReq.write(loginData);
loginReq.end();
