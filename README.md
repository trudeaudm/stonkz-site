# stonkz-site

Official marketing site for **stonkz.green**. Static, no build step, no framework — a single
self-contained `index.html` plus assets, deployed on **Render** as a static site.

```
render.yaml          Render Blueprint (static site + headers + routes)
public/
  index.html         the entire site
  404.html
  robots.txt
  sitemap.xml
  site.webmanifest
  assets/            favicons, touch icon, og image, avatar, banner
```

Local preview:

```bash
cd public && python3 -m http.server 8080
# open http://localhost:8080
```

---

## Deploy runbook

### 1. Create the repo and push

```bash
cd stonkz-site
git init -b main
git add -A
git commit -m "stonkz.green — static marketing site"
gh repo create trudeaudm/stonkz-site --public --source=. --remote=origin --push
```

### 2. Create the Render service

Render Dashboard → **New** → **Blueprint** → connect `trudeaudm/stonkz-site` → it reads
`render.yaml` and creates a static site named `stonkz-site` on the free plan.

(Manual alternative: **New → Static Site**, publish directory `public`, build command blank.
The Blueprint is preferred — it carries the security headers and cache rules with it.)

First deploy takes ~1 minute and lands on `https://stonkz-site.onrender.com`. Verify the
site loads there **before** touching DNS.

### 3. Point the domains

`render.yaml` already declares `stonkz.green` and `stonkz.meme` as custom domains, and
Render adds the matching `www.` subdomains automatically as redirects. They'll show as
unverified until DNS points at Render.

Then set DNS. **Two paths depending on where the zone lives:**

**If the zone stays at Cloudflare** (recommended — it keeps Email Routing for
`hello@stonkz.green` working, which is a hard prerequisite for the X Verified Orgs
application):

| type | name | value | proxy |
|---|---|---|---|
| CNAME | `@` | `stonkz-site.onrender.com` | **DNS only (grey cloud)** |
| CNAME | `www` | `stonkz-site.onrender.com` | **DNS only (grey cloud)** |

Cloudflare flattens the apex CNAME automatically. Proxy **must** be off during
verification and certificate issuance; it can be turned on afterwards, but leaving it off
is simpler and Render already fronts a CDN.

**If the zone is at a registrar without ALIAS/CNAME-flattening:**

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

### 5. Email — do this before the X application

Cloudflare → **Email Routing** → enable → add `hello@stonkz.green` forwarding to a real
inbox. This adds MX + SPF records automatically and does not conflict with the CNAMEs
above. The X Verified Organizations application requires a domain email address; a Gmail
address will fail review.

### 6. X Verified Organizations

Only after: site live on `stonkz.green` over HTTPS, `hello@stonkz.green` receiving mail,
and `@stonkzgreen` carrying the avatar + dark banner from `assets/`. Review takes
3–14 business days and reviewers open the profile and the domain in the same sitting, so
the site must not look under construction.

---

## Editing

Everything is in `public/index.html` — inline CSS and one inline script, in that order,
with all helpers declared before `boot()`. Push to `main` and Render redeploys.

Content rules live in the project docs (`05-stonkz-brand-voice-guide.md`). The two that
bite most often:

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
- **Google Fonts** are the only third-party request the page makes. `connect-src 'self'`
  means no analytics, no trackers, no beacons — deliberate.
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
