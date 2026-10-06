# Amber terminal app icon

Owner-selected artwork (2026-10-06): amber CRT phosphor glow, a terminal prompt and a
network routing tree on an opaque dark background. Generated with built-in ImageGen;
the original and generation prompt are retained in the ubuntu-server-ai documentation
workspace under `artifacts/cli-proxy-icons/2026-10-06/03-crt.png` and `prompts.json`.

`src/assets/favicon.png` is the 64×64 browser icon. Vite embeds it as a PNG data URI
before processing HTML, preserving the self-contained management page.

`public/apple-touch-icon.png` is the opaque 180×180 iPhone Home Screen icon. The HTML
links to it with cache version `amber-1` and supplies the name `CLI Proxy`. It is an
optional enhancement; no routing, authentication or standalone display mode changes.
Apple documents this mechanism in [Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html).

## Deployment

Deploy `dist/index.html` as `static/management.html` and copy
`dist/apple-touch-icon.png` to `static/apple-touch-icon.png` in the same versioned
release. Keep backend and usage collector bytes unchanged for an icon-only release.
Record the icon checksum in the release manifest. The core UI still requires only
the single HTML file.

On ai-proxy, Caddy serves only the icon path from the release static directory:

```caddyfile
handle /apple-touch-icon.png {
 root * /opt/cliproxyapi/current/static
 header Cache-Control "public, max-age=3600"
 file_server
}
```

Place this handle before the catch-all backend handler. Validate with Caddy's
existing EnvironmentFile, then restart Caddy because its admin API is disabled.
No proxy or collector restart is necessary. Verify HTTPS PNG content type, 180×180
dimensions, matching bytes, HTML icon links and normal login rendering. Actual
iPhone Add to Home Screen must be checked on a device; an existing shortcut may
need to be removed and added again to pick up the artwork.

Rollback the release symlink and this one Caddy handle; preserve database, provider
credentials, keys and all other routes. Future builds must keep deploying the icon.
