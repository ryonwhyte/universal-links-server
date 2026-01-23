# Universal Links Server

A self-hosted server for managing Universal Links (iOS) and App Links (Android) across multiple apps. Features an admin UI, automatic well-known file generation, customizable landing pages, and deferred deep linking support.

![Dashboard](docs/images/dashboard.png)

## Features

- **Multi-App Support** - Manage Universal Links for multiple apps from a single server
- **Admin UI** - Easy-to-use interface for configuring apps and routes
- **Auto-Generated Well-Known Files** - Automatically serves `apple-app-site-association` and `assetlinks.json`
- **Custom Landing Pages** - Configurable templates for users without the app installed
- **Deferred Deep Linking** - Preserve deep link context through app installation
  - Multi-signal matching for iOS (IP + timezone + language + screen dimensions)
  - Install Referrer API for Android (~95% accuracy)
- **User-to-User Referrals** - Built-in referral system with tracking and milestones
- **Open Graph Previews** - Social media link previews with static or dynamic OG tags
- **Route-Level Fallbacks** - Override app-level web fallback URLs per route
- **Analytics Dashboard** - Track link opens and app installs per route
  - Internal analytics or Umami integration
  - Campaign tracking by link path
- **Secure by Default** - CSRF protection, rate limiting, helmet security headers, bcrypt password hashing

![Analytics](docs/images/analytics.png)

## Quick Start

### Using Docker Compose

```bash
# Clone the repository
git clone https://github.com/your-repo/universal-links-server.git
cd universal-links-server

# Start the server
docker compose up -d

# Access the admin UI
open http://localhost:3000/admin
```

Default credentials: `admin@example.com` / `changeme`

### Manual Setup

```bash
# Install dependencies
npm install

# Create .env file
cp .env.example .env
# Edit .env with your settings

# Seed the database with admin user
npm run seed

# Development
npm run dev

# Production
npm run build
npm start
```

## Configuration

Create a `.env` file based on `.env.example`:

```env
PORT=3000
NODE_ENV=production
SESSION_SECRET=your-secret-key-change-in-production
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=changeme
TRUST_PROXY=false
CLEANUP_KEY=your-cleanup-secret
```

## How It Works

### 1. Configure Your App

In the admin UI, create an app with:
- **Domain(s)** - The domains that will serve your Universal Links (e.g., `go.myapp.com`)
- **iOS Config** - Team ID, Bundle ID, App Store URL
- **Android Config** - Package name, SHA256 fingerprints, Play Store URL

### 2. Add Routes

Routes define the URL patterns your app handles:
- **Prefix** - URL path segment (e.g., `m` for `/m/TOKEN`)
- **Name & Description** - Human-readable identifiers
- **Template** - Landing page template for users without the app
- **API Endpoint** - Optional API to fetch data for the landing page
- **Web Fallback URL** - Override app-level fallback for desktop users
- **OG Settings** - Social media preview (title, description, image)
- **Dynamic OG Fetch** - Fetch OG tags from web fallback destination

### 3. Point Your Domain

Configure your domain's DNS to point to the server. The server will automatically serve:
- `/.well-known/apple-app-site-association` for iOS
- `/.well-known/assetlinks.json` for Android

### 4. Handle Deep Links

When a user visits a link like `https://go.myapp.com/m/ABC123`:

1. **App Installed** - iOS/Android opens the app directly with the deep link
2. **App Not Installed** - Server shows a landing page with install buttons

### Deferred Deep Linking

For users who need to install the app first:

**Android:**
1. User clicks Play Store link with referrer token
2. After install, app calls Install Referrer API
3. App calls `/api/deferred/claim?token=REFERRER_TOKEN`
4. Server returns the original deep link path

**iOS (Multi-Signal Matching):**
1. Landing page captures device signals (IP, timezone, language, screen size)
2. Signals are sent to server via `/api/deferred/signals`
3. After install, app sends same signals to `/api/deferred/claim`
4. Server matches based on signal similarity within a 2-hour window
5. Returns the original deep link path

The multi-signal approach improves iOS matching accuracy by using multiple data points rather than relying solely on fingerprinting.

### Referral System

Built-in user-to-user referral tracking:

1. **Generate Referral Links** - `POST /api/referrals` creates a unique referral code
2. **Share Links** - Users share `https://go.yourapp.com/ref/CODE`
3. **Track Conversions** - When referred users complete milestones, referrals are marked complete
4. **Per-App Settings** - Configure per app:
   - Enable/disable referrals
   - Referral expiration (days)
   - Max referrals per user
   - Reward milestone trigger

### Open Graph Previews

Control how your links appear when shared on social media:

**Static OG Tags:**
- Set default OG title, description, and image at the app level
- Override per route for specific link types

**Dynamic OG Fetching:**
- Enable "Fetch preview from web fallback URL" on a route
- Server fetches OG tags from the web fallback destination
- Useful for routes with dynamic content (e.g., product pages)
- Results are cached for performance

## API Endpoints

### Public

| Endpoint | Description |
|----------|-------------|
| `GET /.well-known/apple-app-site-association` | iOS Universal Links config |
| `GET /.well-known/assetlinks.json` | Android App Links config |
| `GET /:prefix/:token` | Landing page for deep links |
| `GET /ref/:code` | Referral landing page |
| `GET /install` | Smart redirect to app store |
| `GET /api/deferred/claim` | Claim deferred deep link |
| `POST /api/deferred/signals` | Send device signals for iOS matching |
| `POST /api/referrals` | Create a referral code |
| `GET /api/referrals/:code` | Get referral by code |
| `POST /api/referrals/:code/complete` | Mark referral as complete |
| `POST /api/referrals/:code/milestone` | Update referral milestone |
| `POST /api/path` | Track link opens from installed apps |
| `GET /api/app/info` | Get app info by domain |
| `GET /health` | Health check |

### Admin (authenticated)

| Endpoint | Description |
|----------|-------------|
| `GET /admin` | Dashboard |
| `GET/POST /admin/apps/new` | Create app |
| `GET/POST /admin/apps/:id` | Edit app |
| `GET /admin/apps/:id/export` | Export app config |
| `POST /admin/apps/:id/delete` | Delete app |
| `GET/POST /admin/apps/:id/routes` | Manage routes |
| `GET /admin/apps/import` | Import app config |
| `GET /admin/referrals` | View all referrals |
| `GET /admin/analytics` | Analytics dashboard |
| `GET /admin/templates` | Manage templates |
| `GET /admin/settings` | User settings |
| `GET/POST /admin/change-password` | Change password |

## Custom Templates

Templates define the landing page shown to users who don't have the app installed. The system supports both built-in templates and custom templates.

### Template Priority

1. **Custom templates** - `custom-templates/` folder (editable via admin UI)
2. **Built-in templates** - Included with the app (read-only)

### Creating a Custom Template

**Via Admin UI:**
1. Go to `/admin/templates`
2. Click "New Template"
3. Enter a name and EJS content
4. Set a route to use your template

**Via File System:**
1. Create `custom-templates/my-template.ejs`
2. The template will appear in the admin UI

### Available Template Variables

- `app` - App config (name, logo, store URLs, primary color)
- `route` - Route config (prefix, name, description)
- `token` - Token from URL
- `data` - API response (if endpoint configured)
- `deepLink` - Custom scheme deep link
- `playStoreUrl` - Play Store URL with referrer
- `referrerToken` - Referrer token for deferred linking
- `ogTitle` - Open Graph title
- `ogDescription` - Open Graph description
- `ogImage` - Open Graph image URL
- `isIOS` / `isAndroid` / `isMobile` - Device detection flags

### Example Template

```ejs
<article>
  <h1><%= data?.title || 'Open in App' %></h1>
  <p><%= data?.description %></p>

  <a href="<%= app.ios_app_store_url %>" class="button">
    Download on App Store
  </a>
  <a href="<%= playStoreUrl %>" class="button">
    Get it on Google Play
  </a>
</article>
```

## Analytics

The analytics dashboard tracks link opens and app installs across your apps.

### Event Types

- **link_opened** - A user opened the app via a Universal/App Link
- **install** - A new user installed and claimed a deferred deep link

### Tracking from Your App

When a user opens your app via Universal Link (bypassing the server), you can track it by calling:

```bash
POST /api/path
Content-Type: application/json
Host: go.yourapp.com

{
  "path": "/merchant/abc123",
  "platform": "ios",
  "source": "universal_link"
}
```

### Umami Integration

For more advanced analytics, you can forward events to Umami:

1. Go to `/admin/settings`
2. Enable "Forward to Umami"
3. Enter your Umami Website ID and Host URL

## Maintenance

### Automated Cleanup

Expired deferred deep links should be periodically removed. Set up a scheduled task to call the cleanup endpoint:

```bash
# Cron job (runs daily at 3am)
0 3 * * * curl -X POST -H "Authorization: your-cleanup-key" https://go.yourapp.com/api/cleanup
```

**Environment variable:** Set `CLEANUP_KEY` to a secret value and use it in the Authorization header.

**Docker/PaaS platforms:** Use your platform's scheduled task feature:
- **Dokploy/Coolify:** Add a scheduled job in app settings
- **Portainer:** Use the container's cron or a sidecar
- **Kubernetes:** Create a CronJob resource

## Tech Stack

- **Runtime:** Node.js 20
- **Framework:** Express
- **Language:** TypeScript
- **Database:** SQLite (better-sqlite3)
- **UI:** Pico CSS
- **Templating:** EJS
- **Auth:** express-session + bcrypt

## Project Structure

```
├── src/
│   ├── index.ts          # Express app setup
│   ├── config.ts         # Environment config
│   ├── db/               # Database client & schema
│   ├── middleware/       # Auth, CSRF, logging
│   ├── routes/
│   │   ├── admin/        # Admin UI routes
│   │   └── public/       # Public routes
│   ├── services/
│   │   ├── analytics.ts  # Event tracking & stats
│   │   ├── deferred.ts   # Deferred deep links
│   │   ├── fingerprint.ts # Device fingerprinting
│   │   └── templates.ts  # Template management
│   └── views/            # EJS templates
├── custom-templates/     # User-defined templates (persisted)
├── public/               # Static assets
├── data/                 # SQLite database
├── Dockerfile
├── docker-compose.yml
└── package.json
```

## License

MIT
