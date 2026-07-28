# Hosting Guide: Deploying to ranjit.work

This guide details how to deploy your **Room-Scale Continuous Mouse Driver & Visualizer** to your website portal `ranjit.work` (e.g. `mouse.ranjit.work` or `ranjit.work/mouse-driver`).

---

## 1. Important Browser Requirement: HTTPS (SSL)

Modern browsers enforce a **Secure Context (HTTPS)** for sensitive web APIs like the **Pointer Lock API** (`requestPointerLock()`). 

- Local testing (`http://localhost:8000`) works because browsers treat `localhost` as secure.
- When deployed on your live domain (`ranjit.work`), the site **must serve over HTTPS** (`https://...`), which is provided automatically by Cloudflare, Vercel, Netlify, or Let's Encrypt.

---

## 2. Deployment Methods

### Method A: Static Web Hosting (Cloudflare Pages / Vercel / Netlify) — *Recommended*

Since the visualizer consists of static client-side files (`index.html`, `style.css`, `app.js`), you can host it for free with instant global CDN and SSL.

#### Option 1: Vercel / Netlify
1. Push the project files (`index.html`, `style.css`, `app.js`) to a GitHub repository.
2. Connect your GitHub account to [Vercel](https://vercel.com) or [Netlify](https://netlify.com).
3. Import the repository and click **Deploy**.
4. In Vercel/Netlify Domain Settings:
   - Add Custom Domain: `mouse.ranjit.work` or `ranjit.work`.
   - Add a CNAME record in your DNS provider (e.g. Namecheap, Cloudflare, GoDaddy):
     - **Type**: `CNAME`
     - **Name**: `mouse`
     - **Target**: `cname.vercel-dns.com` (or Netlify DNS target)

#### Option 2: Cloudflare Pages
1. Go to your Cloudflare Dashboard -> **Workers & Pages**.
2. Upload the project folder or link GitHub repository.
3. Under Custom Domains, add `mouse.ranjit.work`. Cloudflare automatically provisions SSL.

---

### Method B: Self-Hosted Web Server (Nginx / Apache on VPS)

If `ranjit.work` runs on your own VPS (e.g., Ubuntu/Debian server with Nginx):

1. **Upload Files**:
   Copy `index.html`, `style.css`, and `app.js` to `/var/www/ranjit.work/mouse-driver/`.

2. **Configure Nginx**:
   Edit your Nginx site configuration file (e.g. `/etc/nginx/sites-available/ranjit.work`):

   ```nginx
   server {
       server_name ranjit.work www.ranjit.work;

       # Serve mouse driver under /mouse-driver path
       location /mouse-driver {
           alias /var/www/ranjit.work/mouse-driver;
           index index.html;
           try_files $uri $uri/ /mouse-driver/index.html;
       }
   }
   ```

3. **Reload Nginx**:
   ```bash
   sudo nginx -t
   sudo systemctl reload nginx
   ```

4. Access at: `https://ranjit.work/mouse-driver`

---

## 3. Embedding as an App on Existing Portal Page (`<iframe>`)

If you want to integrate the mouse driver directly inside a page on your existing portal UI (e.g. `ranjit.work/apps`):

> [!IMPORTANT]
> When embedding inside an `<iframe>`, you **MUST** include the `allow="pointer-lock"` attribute in the iframe tag. Otherwise, browsers will block pointer lock calls inside the iframe.

```html
<!-- Example embedding on ranjit.work/apps page -->
<div class="app-container" style="width: 100%; height: 800px; border-radius: 12px; overflow: hidden;">
  <iframe 
    src="https://mouse.ranjit.work" 
    allow="pointer-lock" 
    style="width: 100%; height: 100%; border: none;">
  </iframe>
</div>
```

---

## 4. Optional: Remote WebSocket Bridge for Python Driver

If you want your local native Python driver (`raw_mouse_driver.py`) running on a physical PC to stream hardware coordinates live to your hosted web app on `ranjit.work`:

1. Start a WebSocket server endpoint in Python (`websockets` library).
2. `app.js` connects to `wss://ranjit.work/ws-mouse` or `ws://localhost:8765`.
3. Hardware ticks from your wireless mouse on Windows stream directly to your web app in real time!
