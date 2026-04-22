const https = require('https');
https.get('https://vidsrc.to/embed/movie/385687', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  }
}, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => console.log('Status:', res.statusCode, '\nData length:', data.length, '\nIncludes Cloudflare?', data.includes('cloudflare')));
});
