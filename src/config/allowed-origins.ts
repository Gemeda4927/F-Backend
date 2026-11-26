export function getAllowedFrontendOrigins() {
  const configured = (
    process.env.CORS_ORIGINS ??
    process.env.FRONTEND_URL ??
    'http://localhost:3000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  return [...new Set(configured)];
}
