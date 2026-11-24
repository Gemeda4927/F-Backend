const deployedFrontendOrigin = 'https://f-fronted-vy1c.vercel.app';

export function getAllowedFrontendOrigins() {
  const configured = (
    process.env.CORS_ORIGINS ??
    process.env.FRONTEND_URL ??
    'http://localhost:3000'
  )
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  const production =
    process.env.APP_ENV === 'production' || process.env.NODE_ENV === 'production';
  return [
    ...new Set(
      production ? [...configured, deployedFrontendOrigin] : configured,
    ),
  ];
}
