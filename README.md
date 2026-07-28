# stonkz-site

Official marketing site for **stonkz.green** (primary) with **stonkz.meme** as
alias. Static, no build step, no framework — a single self-contained
`index.html` plus assets, deployed on **Render** as a static site.

```
render.yaml          Render Blueprint (static site + headers + routes)
public/
  index.html         the entire site
  404.html
  robots.txt
  sitemap.xml
  site.webmanifest
  assets/            favicons, touch icon, og image, avatar, banner, X profile assets
```

Local preview:

```bash
cd public && python3 -m http.server 8080
# open http://localhost:8080
```

---

## Stack (owner ruling — do not reintroduce Cloudflare)

| Layer | Provider | Notes |
|---|---|---|
| Hosting | **Render** | Blueprint from `render.yaml`; auto-deploys on push to `main` |
| DNS | **Namecheap** | Apex A → Render; www CNAME → Render hostname |
| Email | **Google Workspace** | `hello@stonkz.green`; SPF + DKIM for Google |

Cloudflare Pages / Cloudflare DNS / Cloudflare Email Routing were earlier plans
and are **superseded**. Do not suggest or restore them.

---

## Deploy runbook

### 1. Create the repo and push (one-time)

```bash
cd stonkz-site
git init -b main
git add -A
git commit -m "stonkz.green — static marketing site"
gh repo create trudeaudm/stonkz-site --public --source=. --remote=origin --push
```

### 2. Create the Render service (one-time)

Render Dashboard → **New** → **Blueprint** → connect `trudeaudm/stonkz-site` → it reads
`render.yaml` and creates a static site named `stonkz-site` on the free plan.

(Manual alternative: **New → Static Site**, publish directory `public`, build command blank.
The Blueprint is preferred — it carries the security headers and cache rules with it.)

First deploy takes ~1 minute and lands on `https://stonkz-site.onrender.com`. Verify the
site loads there **before** touching DNS.

### 3. Point the domains (Namecheap)

`render.yaml` already declares `stonkz.green` and `stonkz.meme` as custom domains, and
Render adds the matching `www.` subdomains automatically as redirects.

| type | name | value |
|---|---|---|
| A | `@` | `216.24.57.1` |
| CNAME | `www` | `stonkz-site.onrender.com` |

Use the plain A record at the apex rather than ALIAS/ANAME — ALIAS records resolve to
Render's edge IPs, which do not answer the certificate challenge for apex domains.

**Delete any AAAA records** for these names. Render is IPv4-only and stray AAAA records
break both routing and certificate issuance.

### 4. Verify

Back in Render → **Custom Domains** → **Verify**. Certificates issue automatically
(Let's Encrypt) once DNS resolves; HTTP→HTTPS redirect is automatic. Check propagation
with `dig stonkz.green` or dnschecker.org if verification fails, then retry.

### 5. Email (Google Workspace)

Add `stonkz.green` in Google Workspace (secondary domain or primary). Set MX to
Google's (`smtp.google.com` priority 1 per Workspace docs), plus SPF
`v=spf1 include:_spf.google.com ~all` and DKIM on `google._domainkey`.
`hello@stonkz.green` is the public contact.

If MX still shows registrar forwarding (`eforward*.registrar-servers.com`), the
Workspace cutover is incomplete — fix at Namecheap before treating email as done.

### 6. Day-to-day deploys

Edit `public/index.html` (or assets), commit, push to `main`. Render redeploys
automatically. No CI in this repo.

---

## Editing

Everything is in `public/index.html` — inline CSS and one inline script, in that order,
with all helpers declared before `boot()`. Push to `main` and Render redeploys.

Content rules live in the contracts-repo working docs (`docs/05-brand-voice-guide.md`).
The two that bite most often:

- **The one-hover rule** — every playful claim ships with its formula one click away
  (`<details>` blocks in the mechanism section). If a line can't be backed, it gets cut.
- **Nothing inside the CRT is a joke.** The dark phosphor panels carry numbers only.

The hero ladder is a seeded, client-side **simulation** and is labelled as such on the
face of the panel. If it ever becomes real data, the label changes in the same commit.

---

## Notes on the config

- **404s are soft.** `render.yaml` rewrites unmatched paths to `/404.html`. Render rewrites
  return HTTP 200, so crawlers see a soft 404. For a one-page site that's an acceptable
  trade for a branded error page; swap the route to a `redirect` to `/` if it ever matters.
- **CSP allows `'unsafe-inline'`** because the site is deliberately one file with inline
  CSS and one inline script. If the site ever grows external JS, move to hashes.
- **Analytics**: Google Analytics 4 (`G-25H4RJS83Z`). The CSP allows googletagmanager
  and google-analytics origins for exactly this. Custom events: `email_click`,
  `x_click`, `formula_open` (did they open the maths?), `motion_toggle`.
- **Link tagging**: every link posted to X carries
  `?utm_source=x&utm_medium=social&utm_campaign=<slug>`. t.co wrapping and the X
  mobile apps strip referrers, so untagged links land in Direct and are unattributable.
- **Cache headers** treat `/assets/*` as immutable for a year. If an asset changes,
  change its filename.
- **Motion policy (human ruling).** Motion runs by default for **everyone**,
  including visitors whose OS asks for reduced motion. This is a deliberate
  departure from `the_floor.txt` rule 4 and should be recorded in the decisions
  ledger. The mitigation is a persistent user-facing off switch:
  the `motion:` toggle in the taskbar (always visible), remembered in
  `localStorage`, plus `?motion=off` as a direct link. Every `localStorage`
  access is try-guarded so private/blocked storage degrades to session-only.
  What motion covers: arrow bob, ticker scroll, price flash, ladder tick.
  Nothing is motion-only — the CRT readout carries the same numbers either way.
