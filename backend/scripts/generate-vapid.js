// Generates a VAPID key pair for web push notifications.
// Usage (in backend/): npm run generate-vapid            → lines to paste into backend/.env
//                      npm run generate-vapid -- --json  → { "publicKey": "...", "privateKey": "..." }
// Keep the private key secret. Changing the keys invalidates every existing browser subscription.
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ publicKey, privateKey }));
} else {
  console.log('# Web push (VAPID) keys: add these lines to backend/.env');
  console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
  console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
  console.log('VAPID_SUBJECT=mailto:admin@campuslink.local');
}
