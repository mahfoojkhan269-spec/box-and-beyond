// Base URL of the backend API. Change this for local dev vs. production.
// Using the free onrender.com URL directly — no custom domain set up (by choice, to avoid the paid custom-domain slot).
window.API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4100'
  : 'https://box-and-beyond-api.onrender.com';
