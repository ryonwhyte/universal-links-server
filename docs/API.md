# Universal Links Server - API Documentation

## Authentication

Some API endpoints require authentication via an API key. Set the `API_KEY` environment variable to enable authentication.

### Providing the API Key

You can provide the API key in three ways:

1. **X-API-Key Header** (recommended)
   ```
   X-API-Key: your-api-key-here
   ```

2. **Authorization Bearer Header**
   ```
   Authorization: Bearer your-api-key-here
   ```

3. **Query Parameter**
   ```
   ?api_key=your-api-key-here
   ```

If `API_KEY` is not configured in the environment, authentication is disabled and all endpoints are publicly accessible.

---

## Referral API

The referral system allows you to create user-to-user referral links and track conversions.

**Important:** Referrals must be enabled per-app in the admin dashboard. Each app can configure:
- **Enabled/Disabled** - Whether the referral system is active
- **Expiration Days** - How long pending referrals remain valid (default: 30 days)
- **Max Per User** - Maximum pending referrals per referrer (optional)
- **Reward Milestone** - Which milestone triggers rewards (default: "completed")

### Create Referral Link

Create a unique referral link for a user.

```
POST /api/referral/create
```

**Authentication:** Required (if API_KEY is configured)

**Request Body:**
```json
{
  "user_id": "user_abc123",
  "metadata": {
    "campaign": "summer-2024",
    "source": "in-app"
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `user_id` | string | Yes | The unique identifier of the referring user |
| `metadata` | object | No | Optional metadata to attach to the referral |

**Response:**
```json
{
  "success": true,
  "referral_code": "ABC123XYZ",
  "referral_url": "https://go.myapp.com/ref/ABC123XYZ",
  "referral_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Example:**
```bash
curl -X POST https://go.myapp.com/api/referral/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"user_id": "user_abc123"}'
```

**Error Responses:**

| Status | Error | Description |
|--------|-------|-------------|
| 403 | `Referrals are not enabled for this app` | Referrals must be enabled in app settings |
| 400 | `Maximum referrals per user reached` | User has hit the max pending referrals limit |

---

### Update Milestone

Update the milestone for a referral to track progress (e.g., signed_up, purchased).

```
POST /api/referral/milestone
```

**Authentication:** Required (if API_KEY is configured)

**Request Body:**
```json
{
  "referral_code": "ABC123XYZ",
  "milestone": "signed_up"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | string | Yes | The referral code |
| `milestone` | string | Yes | The milestone name (e.g., `signed_up`, `purchased`, or any custom value) |

**Response:**
```json
{
  "success": true,
  "referral": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "referral_code": "ABC123XYZ",
    "milestone": "signed_up",
    "status": "pending"
  }
}
```

**Default Milestones:**
- `pending` - Set when referral is created
- `installed` - Auto-set when deferred link is claimed
- `completed` - Set when referral is completed

**Custom Milestones:** You can use any string value for custom milestones (e.g., `signed_up`, `purchased`, `subscribed`).

**Example:**
```bash
curl -X POST https://go.myapp.com/api/referral/milestone \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"referral_code": "ABC123XYZ", "milestone": "signed_up"}'
```

---

### Complete Referral

Mark a referral as completed when a referred user completes the desired action.

```
POST /api/referral/complete
```

**Authentication:** Required (if API_KEY is configured)

**Request Body:**
```json
{
  "referral_code": "ABC123XYZ",
  "referred_user_id": "user_xyz789",
  "milestone": "purchased"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `referral_code` | string | Yes | The referral code from the referral link |
| `referred_user_id` | string | Yes | The unique identifier of the new user who was referred |
| `milestone` | string | No | Final milestone (defaults to `completed`) |

**Response:**
```json
{
  "success": true,
  "referral": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "referrer_id": "user_abc123",
    "referred_user_id": "user_xyz789",
    "status": "completed",
    "milestone": "purchased",
    "completed_at": "2024-01-15T10:30:00.000Z"
  }
}
```

**Example:**
```bash
curl -X POST https://go.myapp.com/api/referral/complete \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"referral_code": "ABC123XYZ", "referred_user_id": "user_xyz789", "milestone": "purchased"}'
```

---

### Get Referral Info

Get information about a referral by its code.

```
GET /api/referral/:code
```

**Authentication:** None required

**Response:**
```json
{
  "success": true,
  "referral": {
    "referrer_id": "user_abc123",
    "status": "pending",
    "milestone": "installed",
    "created_at": "2024-01-15T10:00:00.000Z"
  }
}
```

**Example:**
```bash
curl https://go.myapp.com/api/referral/ABC123XYZ
```

---

## Deferred Deep Links API

### Claim Deferred Link

Claim a deferred deep link after app installation.

```
GET /api/deferred/claim
```

**Authentication:** None required

**Query Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `token` | string | Referrer token from Play Store install referrer (Android) |
| `fingerprint` | string | Device fingerprint (iOS) |

**Response:**
```json
{
  "success": true,
  "path": "/m/abc123"
}
```

**Response (if this was a referral link):**
```json
{
  "success": true,
  "path": "/referral/ABC123XYZ",
  "referrer_id": "user_abc123",
  "referral_code": "ABC123XYZ"
}
```

The `referrer_id` and `referral_code` are automatically included when the claimed link was a referral link. The app doesn't need to know the referral code beforehand - it's detected from the stored path.

**Example (Android):**
```bash
curl "https://go.myapp.com/api/deferred/claim?token=abc123"
```

**Example (iOS):**
```bash
curl "https://go.myapp.com/api/deferred/claim?fingerprint=sha256hash"
```

---

### Debug Fingerprint (Development Only)

Get fingerprint debugging information. Only available when `NODE_ENV` is not `production`.

```
GET /api/deferred/debug
```

**Response:**
```json
{
  "ip": "192.168.1.1",
  "userAgent": "Mozilla/5.0...",
  "fingerprint": "sha256hash..."
}
```

---

### Cleanup Expired Links

Trigger cleanup of expired deferred links. Intended for cron jobs.

```
POST /api/deferred/cleanup
```

**Authentication:** Requires `X-Cleanup-Key` header matching `CLEANUP_KEY` environment variable

**Response:**
```json
{
  "success": true,
  "deleted": 42
}
```

**Example:**
```bash
curl -X POST https://go.myapp.com/api/deferred/cleanup \
  -H "X-Cleanup-Key: your-cleanup-key"
```

---

## App Info API

### Get App Info

Get basic information about the app configured for this domain.

```
GET /api/app/info
```

**Response:**
```json
{
  "name": "My App",
  "slug": "myapp",
  "has_ios": true,
  "has_android": true
}
```

---

## Analytics API

### Track Link Open

Track when a link is opened in an already-installed app.

```
POST /api/path
```

**Request Body:**
```json
{
  "path": "/m/abc123",
  "platform": "ios",
  "source": "universal_link"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | Yes | The deep link path that was opened |
| `platform` | string | No | `ios`, `android`, `web`, or `unknown` |
| `source` | string | No | `universal_link`, `direct`, or `deferred` |

**Response:**
```json
{
  "success": true
}
```

---

## Referral Landing Page

When a user clicks a referral link, they are taken to a landing page.

```
GET /ref/:code
```

This renders a landing page with app store download buttons. The referral code is stored for later attribution when the user installs the app.

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "success": false,
  "error": "Error message describing what went wrong"
}
```

**Common HTTP Status Codes:**

| Status | Description |
|--------|-------------|
| 200 | Success |
| 400 | Bad Request - Missing or invalid parameters |
| 401 | Unauthorized - Invalid or missing API key |
| 404 | Not Found - Resource doesn't exist |
| 429 | Too Many Requests - Rate limit exceeded |
| 500 | Internal Server Error |

---

## Rate Limits

The API has rate limiting enabled:

- **General endpoints:** 1000 requests per 15 minutes
- **API endpoints:** 100 requests per 15 minutes
- **Auth endpoints:** 10 requests per 15 minutes

When rate limited, you'll receive a `429 Too Many Requests` response.

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `API_KEY` | No | - | API key for authentication. If not set, authentication is disabled. |
| `CLEANUP_KEY` | No | - | Key for the cleanup endpoint |
| `SESSION_SECRET` | Yes | - | Secret for session encryption |
| `DATABASE_PATH` | No | `./data/database.sqlite` | Path to SQLite database |
| `PORT` | No | `3000` | Server port |
| `NODE_ENV` | No | `development` | Environment (`development` or `production`) |
| `TRUST_PROXY` | No | `false` | Set to `true` if behind a reverse proxy |

---

## Typical Integration Flow

### 1. User A Requests Referral Link (In-App)

Your app backend calls the API to get a referral link:

```bash
curl -X POST https://go.myapp.com/api/referral/create \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"user_id": "userA_123"}'
```

Returns:
```json
{
  "success": true,
  "referral_code": "ABC123XYZ",
  "referral_url": "https://go.myapp.com/ref/ABC123XYZ"
}
```

### 2. User A Shares Link

User A shares `https://go.myapp.com/ref/ABC123XYZ` via SMS, social media, etc.

### 3. User B Clicks Link

User B visits `https://go.myapp.com/ref/ABC123XYZ` and sees the referral landing page with app store buttons.

### 4. User B Installs App

User B downloads from App Store or Play Store.

### 5. App Claims Deferred Link

On first launch, your app calls:

```bash
# Android (using Install Referrer token)
curl "https://go.myapp.com/api/deferred/claim?token=xyz"

# iOS (using fingerprint)
curl "https://go.myapp.com/api/deferred/claim?fingerprint=sha256hash"
```

Returns (referrer info is **automatically included** for referral links):
```json
{
  "success": true,
  "path": "/referral/ABC123XYZ",
  "referrer_id": "userA_123",
  "referral_code": "ABC123XYZ"
}
```

The app now knows:
- This user came from a referral (`path` starts with `/referral/`)
- Who referred them (`referrer_id`)
- The referral code to complete later (`referral_code`)

**Note:** The milestone is automatically set to `installed` when the claim succeeds.

### 6. (Optional) Track Custom Milestones

As User B progresses through your app, update milestones:

```bash
# When User B signs up
curl -X POST https://go.myapp.com/api/referral/milestone \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"referral_code": "ABC123XYZ", "milestone": "signed_up"}'
```

### 7. Complete Referral

When User B completes the qualifying action (e.g., makes a purchase):

```bash
curl -X POST https://go.myapp.com/api/referral/complete \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{"referral_code": "ABC123XYZ", "referred_user_id": "userB_456", "milestone": "purchased"}'
```

### 8. Reward Both Users

Your app logic rewards User A (referrer) and optionally User B (referred).

---

## Milestone Tracking

Milestones help you track the referee's progress through your conversion funnel.

### Default Milestones

| Milestone | When Set |
|-----------|----------|
| `pending` | Automatically when referral is created |
| `installed` | Automatically when deferred link is claimed |
| `completed` | When `POST /api/referral/complete` is called |

### Custom Milestones

You can set any custom milestone value using the `/api/referral/milestone` endpoint:

- `signed_up` - User registered
- `verified` - User verified email/phone
- `purchased` - User made a purchase
- `subscribed` - User subscribed
- Any other string value

### Milestone Flow Example

```
pending → installed → signed_up → purchased → completed
   ↑          ↑           ↑           ↑           ↑
 create    claim      milestone   milestone   complete
```
