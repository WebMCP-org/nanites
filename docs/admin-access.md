# Admin Access

SigVelo admin access is Cloudflare-only:

1. Cloudflare Access protects `/admin` and `/admin/*` at the edge.
2. Admin RPCs live under `/admin/rpc/*`, so they stay inside the same protected path.
3. The Worker verifies the `Cf-Access-Jwt-Assertion` header before serving the admin app or admin RPCs.
4. The normal GitHub-authenticated app under `/`, `/app`, and `/rpc/*` is separate and does not participate in admin auth.

## Production bindings

Set these production Worker vars:

- `CLOUDFLARE_ACCESS_TEAM_DOMAIN=alexnahasprojects.cloudflareaccess.com`
- `CLOUDFLARE_ACCESS_AUD=<SigVelo Admin Access app aud>`

## Cloudflare Access app

Create an account-level self-hosted Access application named `SigVelo Admin` with:

- primary domain `app.sigvelo.com/admin`
- destinations `app.sigvelo.com/admin` and `app.sigvelo.com/admin/*`
- `path_cookie_attribute=true`
- `auto_redirect_to_identity=false`
- an Allow policy for the authorized email(s) (e.g., `admin@example.com`)

Do not add app-side redirects for Access. The Cloudflare login screen must appear before the Worker or SPA handles `/admin`.

## Expected flow

1. A user opens `/admin`.
2. Cloudflare Access challenges the request and issues the Access cookie for the admin path.
3. After the Access login completes, the browser lands directly on the admin SPA.
4. Admin route guards call `/admin/rpc/admin/me/get` to confirm the Access identity is still valid for this request.
5. Authenticated users load the admin dashboard. Requests with a missing, expired, or invalid Access identity land on `/admin/not-authorized`.

## Local development

When `CLOUDFLARE_ACCESS_TEAM_DOMAIN` and `CLOUDFLARE_ACCESS_AUD` are empty, admin JWT verification is disabled. Local loopback development (`localhost` / `127.0.0.1`) can still reach `/admin`, and `ALLOW_TEST_AUTH=true` also enables the same synthetic local admin identity for explicit test-auth workflows.
