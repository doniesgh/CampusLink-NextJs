// Web push endpoints the backend is allowed to send to.
//
// The endpoint of a web push subscription comes from the client, and the backend POSTs to it every time the user
// is notified. Only the push services of the browsers are accepted, so nobody can make the server send requests to
// internal hosts (localhost, private or link-local ranges, cloud metadata) or to any other third party (SSRF).
// The check runs when a subscription is registered (pushController) and again before every send (pushService).

const MAX_ENDPOINT_LENGTH = 2048;

// Exact host names.
const PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com', // Chrome, Chromium-based browsers (Opera, Samsung Internet, Edge on Android...)
];

// Any subdomain of these domains.
const PUSH_SERVICE_DOMAINS = [
  'push.services.mozilla.com', // Firefox: updates.push.services.mozilla.com
  'notify.windows.com', // Edge on Windows (WNS): wns2-xxx.notify.windows.com
  'push.apple.com', // Safari: web.push.apple.com
];

// Printable ASCII only: no spaces, control characters or backslashes, which URL parsers handle differently.
const SAFE_CHARACTERS = /^[\x21-\x5b\x5d-\x7e]+$/;

// "https://" (lower case, as browsers send it) + a host name made of letters, digits, dots and dashes, directly
// followed by the path, the query, the fragment or the end. No user info ("user@"), no port (":443") and no IP v6
// literal can appear, so the WHATWG parser and the legacy url.parse() used by web-push read the same host.
const ENDPOINT_PREFIX = /^https:\/\/((?:[a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+)(?=[/?#]|$)/;

const isAllowedPushHost = (hostname) =>
  PUSH_SERVICE_HOSTS.includes(hostname) || PUSH_SERVICE_DOMAINS.some((domain) => hostname.endsWith(`.${domain}`));

// True when `value` is an https URL of a browser push service, without an explicit port or credentials.
const isAllowedPushEndpoint = (value) => {
  if (typeof value !== 'string' || value.length > MAX_ENDPOINT_LENGTH || !SAFE_CHARACTERS.test(value)) return false;

  const match = ENDPOINT_PREFIX.exec(value);
  if (!match) return false;
  const host = match[1].toLowerCase();

  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  return (
    url.protocol === 'https:' &&
    url.hostname === host &&
    url.port === '' &&
    url.username === '' &&
    url.password === '' &&
    isAllowedPushHost(host)
  );
};

module.exports = {
  MAX_ENDPOINT_LENGTH,
  PUSH_SERVICE_HOSTS,
  PUSH_SERVICE_DOMAINS,
  isAllowedPushHost,
  isAllowedPushEndpoint,
};
