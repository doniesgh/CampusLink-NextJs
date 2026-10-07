// Small readers for environment variables. They are called lazily (at request or job time),
// so the values always come from the environment loaded by dotenv in app.js.

const envString = (name, fallback = '') => {
  const value = process.env[name];
  return value === undefined || value.trim() === '' ? fallback : value.trim();
};

// "true" / "1" / "yes" / "on" → true, "false" / "0" / "no" / "off" → false, else the fallback.
const envBool = (name, fallback) => {
  const value = envString(name, '').toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  return fallback;
};

// Positive number, else the fallback.
const envNumber = (name, fallback) => {
  const value = Number(envString(name, ''));
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const isProduction = () => process.env.NODE_ENV === 'production';

// Express "trust proxy" setting from TRUST_PROXY (default "loopback"):
// "true"/"false", a hop count ("1"), or addresses/subnets ("loopback, 10.0.0.0/8").
const trustProxySetting = () => {
  const value = envString('TRUST_PROXY', 'loopback');
  if (value.toLowerCase() === 'true') return true;
  if (value.toLowerCase() === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
};

// Public URL of this API without a trailing slash (PUBLIC_API_URL, default http://localhost:<PORT>).
const publicApiUrl = () =>
  envString('PUBLIC_API_URL', `http://localhost:${Number(process.env.PORT) || 4000}`).replace(/\/+$/, '');

module.exports = { envString, envBool, envNumber, isProduction, trustProxySetting, publicApiUrl };
