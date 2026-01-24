const http = require('http');

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
      console.log('Got token, testing friends API...\n');
      
      const friendsOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/v1/friends',
        method: 'GET',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json'
        }
      };
      
      const friendsReq = http.request(friendsOptions, (resFriends) => {
        let friendsBody = '';
        resFriends.on('data', (chunk) => friendsBody += chunk);
        resFriends.on('end', () => {
          console.log('Friends API Response:');
          console.log(friendsBody);
        });
      });
      
      friendsReq.end();
    } else {
      console.log('Login failed:', JSON.stringify(json, null, 2));
    }
  });
});

loginReq.write(loginData);
loginReq.end();
