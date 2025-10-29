# Headless Multi-User WhatsApp Gateway with NodeJS

Easy Setup Headless multi-user WhatsApp Gateway with NodeJS

## 🆕 New Features

- **Multi-user Support**: Multiple users with individual authentication
- **User Management**: Admin panel for creating and managing users
- **Single Session Per User**: Each regular user has their own isolated WhatsApp session
- **SQLite Database**: Secure credential storage with bcrypt hashing
- **Web Dashboard**: User-friendly UI for session management and QR code generation
- **Per-User Webhooks**: Configure individual webhook URLs for each user
- **Reply/Quote Messages**: Send messages as replies to previous messages

## Core Features

- Support Multi Device
- Support Multi User (Each user manages one WhatsApp session)
- Admin can manage multiple sessions
- Send Text Message
- Send Image
- Send Document
- Send Sticker
- Reply to Messages

#### Read also [wa-multi-session](https://github.com/mimamch/wa-multi-session)

### ⚠️ This application need to running in NodeJS v18 or later. ⚠️

#### Please Read [How to install NodeJS](https://nodejs.org/en/download/package-manager)

## Install and Running

### Option 1: Using NPM (Development/Direct)

#### 1. Clone the project

```bash
  git clone https://github.com/mimamch/wa_gateway.git
```

#### 2. Go to the project directory

```bash
  cd wa_gateway
```

#### 3. Install dependencies

```bash
  npm install
```

#### 4. Configure Environment Variables

Create a `.env` file to set admin credentials and other configurations:

```env
PORT=5001
ADMIN_USER=admin
ADMIN_PASSWORD=your_secure_password
DB_PATH=./wa_gateway.db
```

**Important**: Change the default admin credentials in production! The admin user is NOT stored in the database but validated against these environment variables.

If no `.env` file is created, default credentials are `admin`/`admin`.

#### 5. Start the server

```bash
  npm run start
```

### Option 2: Using Docker (Recommended for Production)

#### 1. Clone the project

```bash
  git clone https://github.com/mimamch/wa_gateway.git
  cd wa_gateway
```

#### 2. Configure Environment Variables

Create a `.env` file in the project root:

```env
PORT=3002
ADMIN_USER=admin
ADMIN_PASSWORD=your_secure_password
WEBHOOK_BASE_URL=https://your-domain.com/webhook  # Optional
```

#### 3. Start with Docker Compose

```bash
  docker-compose up -d
```

The application will be available at `http://localhost:3002`

**Docker Features:**
- Automatic restart on failure
- Health checks
- Persistent data storage (credentials, media, database)
- Isolated network

**Docker Volumes:**
- `./wa_credentials` - WhatsApp session credentials
- `./media` - Media files from messages
- `./db` - SQLite database

## Access the Application

**NPM Installation:**
```
http://localhost:5001/
```

**Docker Installation:**
```
http://localhost:3002/
```

You'll be greeted with a welcome page with links to:
- **Dashboard** (`/dashboard`): For regular users to manage their WhatsApp session and generate QR codes
- **Admin Panel** (`/admin`): For admin to create and manage users (requires admin credentials)

## 👥 User Types and Authentication

### Admin User
- Credentials are set via environment variables (`ADMIN_USER` and `ADMIN_PASSWORD`)
- **NOT stored in the database** - exists only for admin interface access
- Can create and manage regular users
- Can create multiple WhatsApp sessions with custom names
- Cannot configure webhooks (admin is for management only)

### Regular Users
- Created by admin through the admin panel
- Credentials stored securely in SQLite database with bcrypt hashing
- Each user has **ONE WhatsApp session** (using their username or configured session name)
- Can configure their own webhook callback URL
- Access their session via the dashboard

## 📱 How to Use

### For Admin - Creating Users

1. Login to `/admin` with admin credentials (from `.env`)
2. Click "Create New User"
3. Enter username and password for the new user
4. Optionally configure a custom session name and webhook URL
5. The user can now login to `/dashboard` with their credentials

### For Regular Users - Connecting WhatsApp

1. Login to `/dashboard` with your user credentials
2. Click "Generate QR Code"
3. The system will:
   - Generate a QR code for your session
   - Display it in the browser
   - Wait for you to scan it with WhatsApp
4. Open WhatsApp on your phone
5. Go to Settings → Linked Devices → Link a Device
6. Scan the QR code displayed
7. Once scanned, your session is connected and ready to send messages!

## 🔐 Authentication

All API endpoints require HTTP Basic Authentication using your username and password.

### Authentication Types

**Admin Authentication:**
- Username/password from environment variables
- Use for admin operations and creating multiple sessions
- Cannot configure webhooks

**Regular User Authentication:**
- Username/password created by admin
- Each user has ONE session (using username or configured session_name)
- Can configure personal webhook URL

### How to Authenticate

Include credentials in requests using HTTP Basic Auth:

```bash
# Using curl with -u flag
curl -u username:password http://localhost:5001/endpoint

# Or using Authorization header
curl -H "Authorization: Basic $(echo -n 'username:password' | base64)" http://localhost:5001/endpoint
```

## 📨 How to Send Messages

### For Regular Users

Regular users send messages using **their single session** (their username or configured session name):

```bash
# Send a text message
curl -u myuser:mypassword -X POST http://localhost:5001/message/send-text \
  -H "Content-Type: application/json" \
  -d '{
    "session": "myuser",
    "to": "628123456789",
    "text": "Hello World"
  }'
```

### For Admin Users

Admin can send messages using any session they've created:

```bash
# Admin creating and using a custom session
curl -u admin:admin -X POST http://localhost:5001/session/start \
  -H "Content-Type: application/json" \
  -d '{"session": "sales_team"}'

# Admin sending a message with that session
curl -u admin:admin -X POST http://localhost:5001/message/send-text \
  -H "Content-Type: application/json" \
  -d '{
    "session": "sales_team",
    "to": "628123456789",
    "text": "Hello from sales team"
  }'
```

### Session Naming Convention

- **Regular users**: Use their username (e.g., `"session": "john"`) or configured session_name
- **Admin**: Can use any custom session name (e.g., `"session": "sales_team"`, `"session": "support"`)

## 🔗 Webhook Configuration

### Per-User Webhooks

Each regular user can configure their own webhook URL to receive messages and session updates:

**Via Dashboard:**
1. Login to `/dashboard`
2. Enter your webhook URL in the configuration
3. Click "Save"

**Via API:**
```bash
curl -u myuser:mypassword -X PUT http://localhost:5001/dashboard/callback \
  -H "Content-Type: application/json" \
  -d '{"callback_url": "https://your-domain.com/webhook"}'
```

### Legacy Global Webhook

You can still set a global webhook URL via environment variable that receives all events:

```env
WEBHOOK_BASE_URL=https://your-domain.com/webhook
```

Both per-user and global webhooks will receive events if configured.

## API Reference

**Note**: All API endpoints require HTTP Basic Authentication.

### Quick Reference

**Session Management:**
- `POST /session/start` - Start a new session
- `GET /session` - List sessions
- `POST /session/logout` - Delete a session

**Messaging:**
- `POST /message/send-text` - Send text message
- `POST /message/send-image` - Send image
- `POST /message/send-document` - Send document
- `POST /message/send-sticker` - Send sticker

**Admin (Admin only):**
- `GET /admin/users` - List all users
- `POST /admin/users` - Create new user
- `PUT /admin/users/:id/password` - Update user password
- `PUT /admin/users/:id/session-config` - Update session config
- `DELETE /admin/users/:id` - Delete user

**Dashboard (Regular users):**
- `GET /dashboard/session-info` - Get session information
- `POST /dashboard/start-session` - Start session with QR
- `POST /dashboard/disconnect-session` - Disconnect session
- `PUT /dashboard/callback` - Update webhook URL

### Authentication Header

All requests must include HTTP Basic Auth credentials:

```bash
curl -u username:password http://localhost:5001/endpoint
```

Or using Authorization header:

```bash
curl -H "Authorization: Basic $(echo -n 'username:password' | base64)" http://localhost:5001/endpoint
```

### Session Management

#### Start a New Session

```http
POST /session/start
GET /session/start?session=SESSION_NAME
```

**Body (POST):**
| Parameter | Type     | Description                                                    |
| :-------- | :------- | :------------------------------------------------------------- |
| `session` | `string` | **Required for admin**. Session name. Regular users use their username automatically |

**Notes:**
- Regular users: Session name is automatically set to their username or configured session_name
- Admin users: Can specify any custom session name
- Returns QR code if session needs to be linked
- Returns success message if already connected

**Example (Regular User):**
```bash
curl -u john:password123 -X POST http://localhost:5001/session/start \
  -H "Content-Type: application/json" \
  -d '{"session": "john"}'  # Must match username
```

**Example (Admin):**
```bash
curl -u admin:admin -X POST http://localhost:5001/session/start \
  -H "Content-Type: application/json" \
  -d '{"session": "sales_team"}'  # Can use any name
```

#### Get All Sessions

```http
GET /session
```

**Returns:**
- For admin: All sessions
- For regular users: Only their own session (if exists)

#### Delete Session

```http
GET /session/logout?session=SESSION_NAME
POST /session/logout
```

| Parameter | Type     | Description                       |
| :-------- | :------- | :-------------------------------- |
| `session` | `string` | **Required**. Session name to delete |

**Notes:**
- Regular users can only delete their own session
- Admin can delete any session

### Messaging

#### Send Text Message

```http
POST /message/send-text
```

| Body                  | Type      | Description                                                              |
| :-------------------- | :-------- | :----------------------------------------------------------------------- |
| `session`             | `string`  | **Required**. Your session name (username for regular users)             |
| `to`                  | `string`  | **Required**. Receiver phone number with country code (e.g., 628123456789) |
| `text`                | `string`  | **Required**. Text message content                                       |
| `is_group`            | `boolean` | **Optional**. Set to `true` if sending to a group                        |
| `quoted_message_id`   | `string`  | **Optional**. Message ID to reply to (for quoting/replying)             |

**Example:**
```bash
curl -u john:password123 -X POST http://localhost:5001/message/send-text \
  -H "Content-Type: application/json" \
  -d '{
    "session": "john",
    "to": "628123456789",
    "text": "Hello World!"
  }'
```

**Example (Reply to a message):**
```bash
curl -u john:password123 -X POST http://localhost:5001/message/send-text \
  -H "Content-Type: application/json" \
  -d '{
    "session": "john",
    "to": "628123456789",
    "text": "This is a reply!",
    "quoted_message_id": "MESSAGE_ID_FROM_WEBHOOK"
  }'
```

#### Send Image

```http
POST /message/send-image
```

| Body                  | Type      | Description                                                              |
| :-------------------- | :-------- | :----------------------------------------------------------------------- |
| `session`             | `string`  | **Required**. Your session name                                          |
| `to`                  | `string`  | **Required**. Receiver phone number with country code                    |
| `text`                | `string`  | **Required**. Image caption                                              |
| `image_url`           | `string`  | **Required**. Image URL (http/https or file:// path)                     |
| `is_group`            | `boolean` | **Optional**. Set to `true` if sending to a group                        |
| `quoted_message_id`   | `string`  | **Optional**. Message ID to reply to                                     |

**Example:**
```bash
curl -u john:password123 -X POST http://localhost:5001/message/send-image \
  -H "Content-Type: application/json" \
  -d '{
    "session": "john",
    "to": "628123456789",
    "text": "Check out this image!",
    "image_url": "https://example.com/image.jpg"
  }'
```

#### Send Document

```http
POST /message/send-document
```

| Body                  | Type      | Description                                                              |
| :-------------------- | :-------- | :----------------------------------------------------------------------- |
| `session`             | `string`  | **Required**. Your session name                                          |
| `to`                  | `string`  | **Required**. Receiver phone number with country code                    |
| `text`                | `string`  | **Required**. Document caption                                           |
| `document_url`        | `string`  | **Required**. Document URL                                               |
| `document_name`       | `string`  | **Required**. Document filename with extension                           |
| `is_group`            | `boolean` | **Optional**. Set to `true` if sending to a group                        |
| `quoted_message_id`   | `string`  | **Optional**. Message ID to reply to                                     |

**Example:**
```bash
curl -u john:password123 -X POST http://localhost:5001/message/send-document \
  -H "Content-Type: application/json" \
  -d '{
    "session": "john",
    "to": "628123456789",
    "text": "Here is the document",
    "document_url": "https://example.com/file.pdf",
    "document_name": "report.pdf"
  }'
```

#### Send Sticker

```http
POST /message/send-sticker
```

| Body                  | Type      | Description                                                              |
| :-------------------- | :-------- | :----------------------------------------------------------------------- |
| `session`             | `string`  | **Required**. Your session name                                          |
| `to`                  | `string`  | **Required**. Receiver phone number with country code                    |
| `image_url`           | `string`  | **Required**. Sticker image URL                                          |
| `is_group`            | `boolean` | **Optional**. Set to `true` if sending to a group                        |
| `quoted_message_id`   | `string`  | **Optional**. Message ID to reply to                                     |

### Admin Endpoints

#### Get All Users (Admin Only)

```http
GET /admin/users
```

Returns list of all regular users (passwords excluded).

#### Create User (Admin Only)

```http
POST /admin/users
```

| Body       | Type     | Description                    |
| :--------- | :------- | :----------------------------- |
| `username` | `string` | **Required**. Min 3 characters |
| `password` | `string` | **Required**. Min 4 characters |

#### Update User Password (Admin Only)

```http
PUT /admin/users/:id/password
```

| Body       | Type     | Description                    |
| :--------- | :------- | :----------------------------- |
| `password` | `string` | **Required**. New password     |

#### Update User Session Config (Admin Only)

```http
PUT /admin/users/:id/session-config
```

| Body           | Type     | Description                         |
| :------------- | :------- | :---------------------------------- |
| `session_name` | `string` | **Optional**. Custom session name   |
| `callback_url` | `string` | **Optional**. Webhook callback URL  |

#### Delete User (Admin Only)

```http
DELETE /admin/users/:id
```

## Examples

### Using cURL

```bash
# Regular user sending a text message
curl -u john:password123 -X POST http://localhost:5001/message/send-text \
  -H "Content-Type: application/json" \
  -d '{
    "session": "john",
    "to": "628123456789",
    "text": "Hello World!"
  }'

# Regular user sending an image
curl -u john:password123 -X POST http://localhost:5001/message/send-image \
  -H "Content-Type: application/json" \
  -d '{
    "session": "john",
    "to": "628123456789",
    "text": "Check this out!",
    "image_url": "https://placehold.co/600x400"
  }'

# Sending to a group
curl -u john:password123 -X POST http://localhost:5001/message/send-text \
  -H "Content-Type: application/json" \
  -d '{
    "session": "john",
    "to": "120363123456789012@g.us",
    "text": "Hello Group!",
    "is_group": true
  }'
```

### Using Axios (JavaScript)

```js
const axios = require('axios');

// Configure axios with authentication
const api = axios.create({
  baseURL: 'http://localhost:5001',
  auth: {
    username: 'john',
    password: 'password123'
  }
});

// Send text message
api.post("/message/send-text", {
  session: "john",
  to: "628123456789",
  text: "Hello World!",
});

// Send image
api.post("/message/send-image", {
  session: "john",
  to: "628123456789",
  text: "Check out this image!",
  image_url: "https://placehold.co/600x400",
});

// Send document
api.post("/message/send-document", {
  session: "john",
  to: "628123456789",
  text: "Here's the file",
  document_url: "https://example.com/report.pdf",
  document_name: "report.pdf"
});

// Reply to a message
api.post("/message/send-text", {
  session: "john",
  to: "628123456789",
  text: "This is a reply!",
  quoted_message_id: "MESSAGE_ID_FROM_WEBHOOK"
});
```

### Using Python Requests

```python
import requests
from requests.auth import HTTPBasicAuth

# Setup authentication
auth = HTTPBasicAuth('john', 'password123')
base_url = 'http://localhost:5001'

# Send text message
response = requests.post(
    f'{base_url}/message/send-text',
    auth=auth,
    json={
        'session': 'john',
        'to': '628123456789',
        'text': 'Hello from Python!'
    }
)

# Send image
response = requests.post(
    f'{base_url}/message/send-image',
    auth=auth,
    json={
        'session': 'john',
        'to': '628123456789',
        'text': 'Check this image!',
        'image_url': 'https://placehold.co/600x400'
    }
)
```

## Webhook Guide

### Per-User Webhooks

Each regular user can configure their own webhook URL to receive messages and session status updates. This is useful when you have multiple users and want each to receive callbacks at different endpoints.

**Configure via Dashboard:**
1. Login to `/dashboard` with user credentials
2. Enter webhook URL in the settings
3. Click Save

**Configure via API:**
```bash
curl -u john:password123 -X PUT http://localhost:5001/dashboard/callback \
  -H "Content-Type: application/json" \
  -d '{"callback_url": "https://your-domain.com/webhook"}'
```

### Legacy Global Webhook

You can also set a global webhook URL in `.env` that receives all events from all users:

```env
WEBHOOK_BASE_URL=https://your-domain.com/webhook
```

**Note:** If both per-user and global webhooks are configured, both will receive the events.

### Webhook Events

All webhook requests use `POST` method with JSON body.

#### 🪝 Message Webhook

Triggered when a message is received.

**Endpoint:** `POST {callback_url}`

**Example Body:**
```json
{
  "session": "john",
  "from": "628123456789@s.whatsapp.net",
  "messageId": "3A5089C2F2652D46EBC5",
  "message": "Hello World",
  "media": {
    "image": null,
    "video": null,
    "document": null,
    "audio": null
  }
}
```

**Note:** The `messageId` can be used with the `quoted_message_id` parameter to reply to messages.

#### 🪝 Session Webhook

Triggered when session status changes.

**Endpoint:** `POST {callback_url}/session`

**Example Body:**
```json
{
  "session": "john",
  "status": "connected"  // or "disconnected" | "connecting"
}
```

### Accessing Media Files

When a message contains media (image, video, document, audio), the media file is saved to the `./media` directory and the filename is included in the webhook.

**Access media via URL:**
```
http://localhost:5001/media/{filename}
```

**Example:**
```
http://localhost:5001/media/3A5089C2F2652D46EBC5.jpg
```

## ❓ Troubleshooting & FAQ

### Common Issues

**Q: I'm getting "Unauthorized" when trying to access the API**

A: Make sure you're including HTTP Basic Auth credentials in your request:
```bash
curl -u username:password http://localhost:5001/endpoint
```

**Q: Can I change my admin password?**

A: Yes! Update the `ADMIN_PASSWORD` in your `.env` file and restart the server.

**Q: I forgot a user's password. How do I reset it?**

A: Login as admin, go to `/admin`, find the user, and update their password.

**Q: How many sessions can a regular user have?**

A: Each regular user has ONE WhatsApp session. Only admin can create multiple sessions with different names.

**Q: My QR code expired before I could scan it**

A: Simply refresh the page or click "Generate QR Code" again to get a new QR code.

**Q: Can I send messages to groups?**

A: Yes! Set `"is_group": true` in your request and use the group ID (ending with `@g.us`) in the `to` field.

**Q: How do I get a group ID?**

A: Group IDs are sent to your webhook when you receive messages from a group. They typically look like `120363123456789012@g.us`.

**Q: My webhook isn't receiving messages**

A: 
1. Verify your callback URL is correct in the dashboard
2. Make sure your webhook endpoint is publicly accessible
3. Check your webhook server logs for incoming requests
4. Ensure your webhook endpoint accepts POST requests with JSON body

**Q: Can I use this with Docker?**

A: Yes! See the Docker installation instructions above. Docker is recommended for production deployments.

**Q: What's the difference between per-user webhooks and global webhook?**

A: 
- **Per-user webhook**: Each user configures their own callback URL. Only that user's messages are sent to their webhook.
- **Global webhook**: Set via `WEBHOOK_BASE_URL` environment variable. Receives ALL messages from ALL users.
- Both can be active simultaneously.

**Q: How do I update to the latest version?**

A: Run `npm install wa-multi-session@latest` and restart the server.

## Upgrading

```
npm install wa-multi-session@latest
```

## Documentation

For detailed documentation, including guides and API references, please visit the [official documentation](https://github.com/mimamch/wa-gateway).

## Contributing

Contributions are welcome! Please follow the guidelines outlined in the [CONTRIBUTING.md](https://github.com/mimamch/wa-gateway/blob/main/CONTRIBUTING.md) file.

## License

This library is licensed under the [MIT License](https://github.com/mimamch/wa-gateway/blob/main/LICENSE).
