# Chapa payment diagnosis ? 2026-11-08

## Reproduced cause and correction

The existing v1 initialize request returned HTTP 400 for one existing course: `customization.description` only allows letters, numbers, hyphens, underscores, spaces and dots. The gateway discarded this validation response and raised the generic provider-unavailable message. The payment service previously copied punctuation from the course title directly into this field. The correction sanitizes only the payment description; course records remain unchanged.

The corrected requests for both existing payment amounts (300.00 ETB and 1000.00 ETB) returned hosted checkout URLs using the actual gateway class. A separate 1.00 ETB sandbox checkout completed through Chapa's hosted page using its documented test phone number. A server-side v1 verification returned HTTP 200, status success, mode test, matching transaction reference, amount 1, currency ETB and a provider reference. This diagnostic checkout was not inserted into LMS records and granted no enrollment.

## Configuration

The locally loaded settings have CHAPA_MODE=test, CHAPA_ALLOW_LIVE=false and a v1 CHASECK_TEST- secret without surrounding whitespace. APP_ENV=development and NODE_ENV=production do not prohibit test payments in current source. Render's saved environment values have not been inspected directly.

Use these non-secret settings on Render, retaining the existing v1 test secret privately:

```dotenv
APP_ENV=production
NODE_ENV=production
CHAPA_MODE=test
CHAPA_ALLOW_LIVE=false
BACKEND_URL=https://f-backend-1-vuw4.onrender.com
FRONTEND_URL=https://f-fronted-it5g.vercel.app
CORS_ORIGINS=https://f-fronted-it5g.vercel.app
COOKIE_SECURE=true
COOKIE_SAME_SITE=none
```

Confirm the frontend hostname is still the intended deployment before applying it. The currently loaded local FRONTEND_URL references f-fronted-ok2h.vercel.app, whose payment return URL returned DEPLOYMENT_NOT_FOUND. The deployed API preflight allows it5g with credentials and rejects the obsolete ok2h origin. Vercel must use NEXT_PUBLIC_API_URL=https://f-backend-1-vuw4.onrender.com/api/v1. Do not place secret keys in NEXT_PUBLIC variables. Keep existing database and JWT settings.

## Safety and remaining validation

All Neon queries in this investigation used READ ONLY transactions; no records, schema, users, courses, payments or enrollments were changed. Two existing PENDING payments have no checkout URL; they were preserved and were not retried or marked successful. No migrations, resets or seeds were run.

Current enrollment code checks provider transaction reference, amount, currency, email and mode before its atomic enrollment write. However a complete deployed LMS checkout-to-enrollment test has NOT been completed. It requires the corrected backend deployment, verified Render settings, a working frontend return URL and a fresh LMS sandbox checkout. Provider-only success is not proof of deployed LMS enrollment. Existing pending records need individual reconciliation before changing their status; do not automatically cancel them merely because a checkout URL is absent.
