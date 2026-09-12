// Base URL of the backend API. Change this for local dev vs. production.
window.API_BASE = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:4100'
  : 'https://api.boxandbeyondservices.in';
