const http = require('http');

const data = JSON.stringify({
  email: 'sdad34461@gmail.com',
  password: 'Owner123456'
});

const options = {
  hostname: 'localhost',
  port: 3000,
  path: '/api/v1/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    const json = JSON.parse(body);
    console.log('Response:', JSON.stringify(json, null, 2));
    
    if (json.success && json.data && json.data.accessToken) {
      const token = json.data.accessToken;
      console.log('\n\nToken:', token);
      
      // Now test pending requests
      const reqPending = http.request({
        hostname: 'localhost',
        port: 3000,
        path: '/api/v1/friends/requests/pending',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      }, (resPending) => {
        let pendingBody = '';
        resPending.on('data', (chunk) => pendingBody += chunk);
        resPending.on('end', () => {
          console.log('\n\nPending Requests Response:', pendingBody);
        });
      });
      reqPending.end();
    }
  });
});

req.write(data);
req.end();
