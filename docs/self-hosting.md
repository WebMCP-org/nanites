# Self-Hosted Runtime

Nanites is installed into the deployment owner's Cloudflare account by the external SigVelo
provisioner. This repo is the runtime artifact, not the installer.

## Boundary

- `nanites` runs GitHub auth, webhooks, MCP, Durable Object agents, UI, and runtime observability.
- `../sigvelo` owns Cloudflare OAuth, resource creation, Worker upload, asset upload, D1 migrations,
  Worker secrets, and GitHub App manifest creation.
- A Nanites runtime has one active deployment GitHub App and one deployment installation.
- Multiple deployments in one Cloudflare account are separate Worker/D1/KV/R2/Durable Object
  resources, not multiple tenants inside one runtime.

## Runtime Contract

The provisioner must install:

- `AUTH_COOKIE_SECRET`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_CLIENT_ID`
- `GITHUB_APP_PRIVATE_KEY`
- `GITHUB_APP_CLIENT_SECRET`
- `GITHUB_APP_WEBHOOK_SECRET`
- GitHub installation rows discovered by the runtime after user sign-in

See [Provisioner Architecture](./architecture/provisioner-architecture.md) for the full contract.

## Local Development

Run the runtime locally:

```bash
vp install
vp run db:migrate:local
vp run dev
```

Local secrets and D1 seed data should mirror the provisioner contract. Do not reintroduce in-Worker
setup routes, deploy buttons, setup agents, or shared control-plane fallbacks here.
