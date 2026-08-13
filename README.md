# MailTracker — Real-Time Email Open & Click Tracking

A lightweight, high-performance, real-time Email Open and Click Tracking service designed for cloud deployment on **Vercel** with **Upstash Redis / Vercel KV** or local development.

Live Production Demo: [https://track.wishop.xyz](https://track.wishop.xyz)

---

## Key Features

* **1x1 Invisible Tracking Pixel**: Embedded `<img src=".../media/v1/UUID.png" />` tag triggers background open events when recipients open HTML emails.
* **Ad-Blocker Evasion**: Neutral endpoint paths (`/media/v1/UUID.png`) prevent ad-blockers and privacy extensions (uBlock Origin, Brave) from blocking image requests.
* **Edge CDN Anti-Caching**: Strict HTTP headers (`Cache-Control: no-store, no-cache, max-age=0, s-maxage=0`) force email clients and Cloud CDNs to fetch the pixel on every re-open.
* **Link Click Tracking**: Automatically wraps email hyperlinks (`/click/UUID?url=...`) to track click counts, timestamps, and target URLs.
* **Real-Time Audit Timeline**: Detailed audit logs tracking recipient IP addresses, timestamps, device types, and User-Agent strings.
* **Gmail 1-Click Clipboard Integration**: One-click **"Copy for Gmail"** button copies rich text (`text/html`) directly onto clipboard for seamless `Ctrl+V` pasting into Gmail Compose.
* **Dual Database Persistence**:
  * **Production**: Connects automatically to **Vercel KV / Upstash Redis** (`REDIS_URL` or `KV_REST_API_URL`).
  * **Local Dev**: Falls back to file-backed JSON storage (`data/emails.json`).
* **Ultra-Fast Non-Blocking Response**: Returns the 1x1 image binary to email clients in **< 5ms** while processing database writes asynchronously.
* **SMTP Integration**: Built-in support for custom SMTP servers (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`) as well as Ethereal Sandbox testing.

---

## How to Use

### 1. Creating a Tracked Email
1. Open your MailTracker dashboard ([https://track.wishop.xyz](https://track.wishop.xyz)).
2. Click **"+ Create Tracked Email"**.
3. (Optional) Enter recipient email and subject line.
4. Type your email body text or HTML content.
5. Click **Generate Tracking Email**.

### 2. Sending via Gmail (1-Click Copy & Paste)
1. In the email inspector modal, click **"Copy for Gmail (Direct Paste)"**.
   *(This copies your text along with the invisible tracking pixel onto your clipboard as rich HTML).*
2. Open **[Gmail](https://mail.google.com)** and click **Compose**.
3. Fill in the recipient address and subject line.
4. Click inside the email message body box and press **`Ctrl + V`** (or **`Cmd + V`** on Mac).
5. Click **Send**!

> **Note on Gmail Compose Preview**: When pasting into Gmail's compose box, Gmail's rich text editor renders a local preview which logs 1 initial open from your own IP address. When the actual recipient opens the email on their device, the open count will increment (e.g. `2x`), and their real IP address & timestamp will be logged on your dashboard timeline.

### 3. Sending Directly via Custom SMTP (No Copy/Paste Required)
If you configure custom SMTP environment variables (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`), MailTracker can send emails directly to recipients from the dashboard with 1 click!

### 4. Viewing Real-Time Open Analytics & Timeline
* Open counts update live on your dashboard every 3 seconds.
* Click **Inspect & Copy** on any email row to view the full **Activity Audit Timeline** showing exact timestamps, recipient IP addresses, and device/browser details.

---

## Project Structure

```text
mail-tracker/
├── api/
│   └── index.js              # Vercel Serverless Function entrypoint
├── public/
│   ├── index.html            # Web Dashboard UI
│   ├── style.css             # Dashboard Styles & Layouts
│   └── app.js                # Frontend Application & Real-time Polling
├── data/
│   └── emails.json           # Local development file database fallback
├── server.js                 # Express server & API endpoints
├── db.js                     # Dual Redis (ioredis/Upstash) & JSON storage handler
├── vercel.json               # Vercel deployment rewrites & routing rules
├── package.json              # Project dependencies
└── README.md                 # Project documentation
```

---

## API Reference

### 1. Tracking Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/media/v1/:id.png` | Serves 1x1 transparent PNG image & records open event asynchronously. |
| `GET` | `/track/:id.png` | Legacy tracking endpoint alias. |
| `GET` | `/click/:id?url=...` | Logs link click event & redirects recipient to target URL. |

### 2. REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/emails` | Fetch all tracked emails and summary statistics. |
| `POST` | `/api/emails` | Create a new tracked email record & generate tracking HTML. |
| `GET` | `/api/emails/:id` | Fetch email details and full audit timeline. |
| `DELETE` | `/api/emails/:id` | Delete a tracked email record. |
| `POST` | `/api/emails/send-test` | Send email via configured SMTP or Ethereal Sandbox. |

---

## How to Deploy on Vercel

1. **Deploy Project**:
   ```bash
   npx vercel --prod
   ```

2. **Connect Redis Database (Vercel KV)**:
   * Go to your [Vercel Dashboard](https://vercel.com/dashboard) -> select your project.
   * Go to **Storage** -> **Create Database** -> select **KV (Redis)**.
   * Click **Connect to Project**. Vercel will automatically inject `REDIS_URL` or `KV_REST_API_URL`.

3. **Custom Domain Setup**:
   * Add your custom domain (e.g. `track.yourdomain.com`) in Vercel Project Settings -> **Domains**.
   * Map CNAME record to `cname.vercel-dns.com`.

---

## Environment Variables

When deploying to production or using custom SMTP, set the following environment variables:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `REDIS_URL` | Redis connection URL | `redis://default:password@host:port` |
| `KV_REST_API_URL` | Upstash Redis REST URL | `https://...upstash.io` |
| `KV_REST_API_TOKEN` | Upstash Redis REST Token | `AXXX...` |
| `SMTP_HOST` | Custom SMTP Server Host | `smtp.gmail.com` |
| `SMTP_PORT` | Custom SMTP Port | `587` |
| `SMTP_USER` | Custom SMTP Username | `user@example.com` |
| `SMTP_PASS` | Custom SMTP Password / App Pass | `xxxx-xxxx-xxxx-xxxx` |
| `SMTP_FROM` | Default From Email Header | `"MailTracker" <user@example.com>` |

---

## Local Development

1. Clone the repository and install dependencies:
   ```bash
   git clone <repo-url>
   cd mail-tracker
   npm install
   ```

2. Start local dev server:
   ```bash
   npm start
   ```

3. Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Security & Privacy

* **Zero Exposure**: Secrets (`REDIS_URL`, `SMTP_PASS`) are processed strictly server-side and never exposed to client-side JS.
* **Sanitized Error Responses**: Raw internal stack traces or connection errors are suppressed in client responses.
* **Header Concealment**: Express `x-powered-by` header is disabled.
* **Git Protection**: `.gitignore` excludes `.env`, `node_modules/`, and local data files.
