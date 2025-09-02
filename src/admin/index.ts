import { Hono } from "hono";
import { createKeyMiddleware } from "../middlewares/key.middleware";

export const createAdminController = () => {
  const app = new Hono();

  // Serve the admin interface (requires authentication)
  app.get("/", createKeyMiddleware(), async (c) => {
    const adminInterface = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>WA Gateway - Management Interface</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css" rel="stylesheet">
        <style>
          .endpoint-card {
            border-left: 4px solid #007bff;
          }
          .method-get { border-left-color: #28a745 !important; }
          .method-post { border-left-color: #007bff !important; }
          .method-delete { border-left-color: #dc3545 !important; }
          .navbar-brand { font-weight: bold; }
          .response-area {
            background-color: #f8f9fa;
            border: 1px solid #dee2e6;
            border-radius: 0.375rem;
            min-height: 100px;
            font-family: 'Courier New', monospace;
            font-size: 0.875rem;
          }
        </style>
      </head>
      <body>
        <nav class="navbar navbar-expand-lg navbar-dark bg-primary">
          <div class="container">
            <a class="navbar-brand" href="#">
              <i class="fas fa-mobile-alt me-2"></i>
              WA Gateway Management
            </a>
            <div class="navbar-nav ms-auto">
              <span class="navbar-text">
                <i class="fas fa-shield-alt me-1"></i>
                Authenticated
              </span>
            </div>
          </div>
        </nav>

        <div class="container mt-4">
          <!-- Configuration Section -->
          <div class="row mb-4">
            <div class="col-12">
              <div class="card">
                <div class="card-header">
                  <h5 class="mb-0">
                    <i class="fas fa-cog me-2"></i>
                    Configuration
                  </h5>
                </div>
                <div class="card-body">
                  <div class="row">
                    <div class="col-md-6">
                      <label for="apiBaseUrl" class="form-label">API Base URL</label>
                      <input type="text" class="form-control" id="apiBaseUrl" value="http://localhost:5001" placeholder="e.g., https://your-api.com">
                      <div class="form-text">Change this to interact with different environments</div>
                    </div>
                    <div class="col-md-6">
                      <label for="apiKey" class="form-label">API Key</label>
                      <input type="password" class="form-control" id="apiKey" placeholder="Enter your API key">
                      <div class="form-text">Required for authentication</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Response Area -->
          <div class="row mb-4">
            <div class="col-12">
              <div class="card">
                <div class="card-header d-flex justify-content-between align-items-center">
                  <h6 class="mb-0">Response</h6>
                  <button class="btn btn-sm btn-outline-secondary" onclick="clearResponse()">
                    <i class="fas fa-trash"></i> Clear
                  </button>
                </div>
                <div class="card-body">
                  <pre id="responseArea" class="response-area p-3 mb-0">No response yet...</pre>
                </div>
              </div>
            </div>
          </div>

          <!-- API Endpoints -->
          <div class="row">
            <!-- Health Check -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-get">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-success me-2">GET</span>
                    Health Check
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Check API health status</p>
                  <button class="btn btn-success" onclick="makeRequest('GET', '/health')">
                    <i class="fas fa-play me-1"></i>
                    Execute
                  </button>
                </div>
              </div>
            </div>

            <!-- Session List -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-get">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-success me-2">GET</span>
                    List Sessions
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Get all active sessions</p>
                  <button class="btn btn-success" onclick="makeRequest('GET', '/session')">
                    <i class="fas fa-play me-1"></i>
                    Execute
                  </button>
                </div>
              </div>
            </div>

            <!-- Start Session -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-post">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-primary me-2">POST</span>
                    Start Session
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Start a new WhatsApp session</p>
                  <div class="mb-3">
                    <label class="form-label">Session Name</label>
                    <input type="text" class="form-control" id="startSession_session" placeholder="e.g., mysession">
                  </div>
                  <button class="btn btn-primary" onclick="startSession()">
                    <i class="fas fa-play me-1"></i>
                    Start Session
                  </button>
                </div>
              </div>
            </div>

            <!-- Logout Session -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-delete">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-danger me-2">DELETE</span>
                    Logout Session
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Logout from a session</p>
                  <div class="mb-3">
                    <label class="form-label">Session Name</label>
                    <input type="text" class="form-control" id="logout_session" placeholder="e.g., mysession">
                  </div>
                  <button class="btn btn-danger" onclick="logoutSession()">
                    <i class="fas fa-sign-out-alt me-1"></i>
                    Logout
                  </button>
                </div>
              </div>
            </div>

            <!-- Send Text Message -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-post">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-primary me-2">POST</span>
                    Send Text Message
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Send a text message</p>
                  <div class="mb-3">
                    <label class="form-label">Session</label>
                    <input type="text" class="form-control" id="sendText_session" placeholder="Session name">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">To</label>
                    <input type="text" class="form-control" id="sendText_to" placeholder="e.g., 5511999999999@s.whatsapp.net">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Message</label>
                    <textarea class="form-control" id="sendText_text" rows="3" placeholder="Your message here"></textarea>
                  </div>
                  <div class="mb-3 form-check">
                    <input type="checkbox" class="form-check-input" id="sendText_isGroup">
                    <label class="form-check-label" for="sendText_isGroup">
                      Is Group Message
                    </label>
                  </div>
                  <button class="btn btn-primary" onclick="sendTextMessage()">
                    <i class="fas fa-paper-plane me-1"></i>
                    Send Message
                  </button>
                </div>
              </div>
            </div>

            <!-- Send Image -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-post">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-primary me-2">POST</span>
                    Send Image
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Send an image message</p>
                  <div class="mb-3">
                    <label class="form-label">Session</label>
                    <input type="text" class="form-control" id="sendImage_session" placeholder="Session name">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">To</label>
                    <input type="text" class="form-control" id="sendImage_to" placeholder="e.g., 5511999999999@s.whatsapp.net">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Image URL</label>
                    <input type="url" class="form-control" id="sendImage_imageUrl" placeholder="https://example.com/image.jpg">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Caption</label>
                    <textarea class="form-control" id="sendImage_text" rows="2" placeholder="Image caption (optional)"></textarea>
                  </div>
                  <div class="mb-3 form-check">
                    <input type="checkbox" class="form-check-input" id="sendImage_isGroup">
                    <label class="form-check-label" for="sendImage_isGroup">
                      Is Group Message
                    </label>
                  </div>
                  <button class="btn btn-primary" onclick="sendImageMessage()">
                    <i class="fas fa-image me-1"></i>
                    Send Image
                  </button>
                </div>
              </div>
            </div>

            <!-- Send Document -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-post">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-primary me-2">POST</span>
                    Send Document
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Send a document</p>
                  <div class="mb-3">
                    <label class="form-label">Session</label>
                    <input type="text" class="form-control" id="sendDoc_session" placeholder="Session name">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">To</label>
                    <input type="text" class="form-control" id="sendDoc_to" placeholder="e.g., 5511999999999@s.whatsapp.net">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Document URL</label>
                    <input type="url" class="form-control" id="sendDoc_documentUrl" placeholder="https://example.com/document.pdf">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Document Name</label>
                    <input type="text" class="form-control" id="sendDoc_documentName" placeholder="document.pdf">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Caption</label>
                    <textarea class="form-control" id="sendDoc_text" rows="2" placeholder="Document caption (optional)"></textarea>
                  </div>
                  <div class="mb-3 form-check">
                    <input type="checkbox" class="form-check-input" id="sendDoc_isGroup">
                    <label class="form-check-label" for="sendDoc_isGroup">
                      Is Group Message
                    </label>
                  </div>
                  <button class="btn btn-primary" onclick="sendDocumentMessage()">
                    <i class="fas fa-file-alt me-1"></i>
                    Send Document
                  </button>
                </div>
              </div>
            </div>

            <!-- Send Sticker -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-post">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-primary me-2">POST</span>
                    Send Sticker
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Send a sticker</p>
                  <div class="mb-3">
                    <label class="form-label">Session</label>
                    <input type="text" class="form-control" id="sendSticker_session" placeholder="Session name">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">To</label>
                    <input type="text" class="form-control" id="sendSticker_to" placeholder="e.g., 5511999999999@s.whatsapp.net">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Image URL</label>
                    <input type="url" class="form-control" id="sendSticker_imageUrl" placeholder="https://example.com/sticker.png">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Text</label>
                    <input type="text" class="form-control" id="sendSticker_text" placeholder="Optional text">
                  </div>
                  <div class="mb-3 form-check">
                    <input type="checkbox" class="form-check-input" id="sendSticker_isGroup">
                    <label class="form-check-label" for="sendSticker_isGroup">
                      Is Group Message
                    </label>
                  </div>
                  <button class="btn btn-primary" onclick="sendStickerMessage()">
                    <i class="fas fa-smile me-1"></i>
                    Send Sticker
                  </button>
                </div>
              </div>
            </div>

            <!-- Get Profile -->
            <div class="col-md-6 mb-4">
              <div class="card endpoint-card method-post">
                <div class="card-header">
                  <h6 class="mb-0">
                    <span class="badge bg-primary me-2">POST</span>
                    Get Profile
                  </h6>
                </div>
                <div class="card-body">
                  <p class="card-text">Get profile information</p>
                  <div class="mb-3">
                    <label class="form-label">Session</label>
                    <input type="text" class="form-control" id="getProfile_session" placeholder="Session name">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Target</label>
                    <input type="text" class="form-control" id="getProfile_target" placeholder="e.g., 5511999999999@s.whatsapp.net">
                  </div>
                  <button class="btn btn-primary" onclick="getProfile()">
                    <i class="fas fa-user me-1"></i>
                    Get Profile
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
        <script>
          function getApiBaseUrl() {
            return document.getElementById('apiBaseUrl').value || 'http://localhost:5001';
          }

          function getApiKey() {
            return document.getElementById('apiKey').value;
          }

          function getHeaders() {
            const headers = {
              'Content-Type': 'application/json'
            };
            
            const apiKey = getApiKey();
            if (apiKey) {
              headers['key'] = apiKey;
            }
            
            return headers;
          }

          function displayResponse(response, status = null) {
            const responseArea = document.getElementById('responseArea');
            const timestamp = new Date().toISOString();
            
            let statusText = '';
            if (status !== null) {
              statusText = \`Status: \${status}\\n\`;
            }
            
            responseArea.textContent = \`[\${timestamp}]\\n\${statusText}\${JSON.stringify(response, null, 2)}\`;
          }

          function clearResponse() {
            document.getElementById('responseArea').textContent = 'No response yet...';
          }

          async function makeRequest(method, endpoint, body = null) {
            try {
              const url = getApiBaseUrl() + endpoint;
              const options = {
                method: method,
                headers: getHeaders()
              };

              if (body) {
                options.body = JSON.stringify(body);
              }

              const response = await fetch(url, options);
              const data = await response.json();
              
              displayResponse(data, response.status);
            } catch (error) {
              displayResponse({ error: error.message }, 'ERROR');
            }
          }

          function startSession() {
            const session = document.getElementById('startSession_session').value;
            if (!session) {
              alert('Please enter a session name');
              return;
            }
            
            const apiBaseUrl = getApiBaseUrl();
            const apiKey = getApiKey();
            
            // Build URL with session parameter and API key
            let url = apiBaseUrl + '/session/start?session=' + encodeURIComponent(session);
            if (apiKey) {
              url += '&key=' + encodeURIComponent(apiKey);
            }
            
            // Open URL in new window
            window.open(url, '_blank', 'width=600,height=600,scrollbars=yes,resizable=yes');
          }

          function logoutSession() {
            const session = document.getElementById('logout_session').value;
            if (!session) {
              alert('Please enter a session name');
              return;
            }
            makeRequest('DELETE', '/session/logout', { session });
          }

          function sendTextMessage() {
            const session = document.getElementById('sendText_session').value;
            const to = document.getElementById('sendText_to').value;
            const text = document.getElementById('sendText_text').value;
            const isGroup = document.getElementById('sendText_isGroup').checked;

            if (!session || !to || !text) {
              alert('Please fill in all required fields');
              return;
            }

            makeRequest('POST', '/message/send-text', {
              session,
              to,
              text,
              is_group: isGroup
            });
          }

          function sendImageMessage() {
            const session = document.getElementById('sendImage_session').value;
            const to = document.getElementById('sendImage_to').value;
            const imageUrl = document.getElementById('sendImage_imageUrl').value;
            const text = document.getElementById('sendImage_text').value;
            const isGroup = document.getElementById('sendImage_isGroup').checked;

            if (!session || !to || !imageUrl) {
              alert('Please fill in all required fields');
              return;
            }

            makeRequest('POST', '/message/send-image', {
              session,
              to,
              text,
              image_url: imageUrl,
              is_group: isGroup
            });
          }

          function sendDocumentMessage() {
            const session = document.getElementById('sendDoc_session').value;
            const to = document.getElementById('sendDoc_to').value;
            const documentUrl = document.getElementById('sendDoc_documentUrl').value;
            const documentName = document.getElementById('sendDoc_documentName').value;
            const text = document.getElementById('sendDoc_text').value;
            const isGroup = document.getElementById('sendDoc_isGroup').checked;

            if (!session || !to || !documentUrl || !documentName) {
              alert('Please fill in all required fields');
              return;
            }

            makeRequest('POST', '/message/send-document', {
              session,
              to,
              text,
              document_url: documentUrl,
              document_name: documentName,
              is_group: isGroup
            });
          }

          function sendStickerMessage() {
            const session = document.getElementById('sendSticker_session').value;
            const to = document.getElementById('sendSticker_to').value;
            const imageUrl = document.getElementById('sendSticker_imageUrl').value;
            const text = document.getElementById('sendSticker_text').value;
            const isGroup = document.getElementById('sendSticker_isGroup').checked;

            if (!session || !to || !imageUrl) {
              alert('Please fill in all required fields');
              return;
            }

            makeRequest('POST', '/message/send-sticker', {
              session,
              to,
              text,
              image_url: imageUrl,
              is_group: isGroup
            });
          }

          function getProfile() {
            const session = document.getElementById('getProfile_session').value;
            const target = document.getElementById('getProfile_target').value;

            if (!session || !target) {
              alert('Please fill in all required fields');
              return;
            }

            makeRequest('POST', '/profile', {
              session,
              target
            });
          }

          // Set default API key from URL parameter if provided
          window.addEventListener('DOMContentLoaded', function() {
            const urlParams = new URLSearchParams(window.location.search);
            const key = urlParams.get('key');
            if (key) {
              document.getElementById('apiKey').value = key;
            }
          });
        </script>
      </body>
      </html>
    `;

    return c.html(adminInterface);
  });

  return app;
};