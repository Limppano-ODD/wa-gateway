import axios, { AxiosRequestConfig } from "axios";
import { User, userDb, WebhookAuthType } from "../database/db";

export interface WebhookAuthConfig {
  authType: WebhookAuthType;
  username?: string | null;
  password?: string | null;
  bearerToken?: string | null;
  oauth2?: {
    clientId: string;
    clientSecret: string;
    tokenUrl: string;
    scope?: string | null;
    accessToken?: string | null;
    tokenExpiry?: number | null;
    refreshToken?: string | null;
  };
}

/**
 * Get authentication headers based on the auth type
 */
export async function getAuthHeaders(
  user: User
): Promise<Record<string, string>> {
  const headers: Record<string, string> = {};

  switch (user.webhook_auth_type) {
    case "basic":
      if (user.webhook_auth_username && user.webhook_auth_password) {
        const credentials = Buffer.from(
          `${user.webhook_auth_username}:${user.webhook_auth_password}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${credentials}`;
      }
      break;

    case "bearer":
      if (user.webhook_auth_bearer_token) {
        headers["Authorization"] = `Bearer ${user.webhook_auth_bearer_token}`;
      }
      break;

    case "oauth2":
      const token = await getOAuth2Token(user);
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
      }
      break;

    case "none":
    default:
      // No authentication headers
      break;
  }

  return headers;
}

/**
 * Get OAuth2 access token, refreshing if necessary
 */
async function getOAuth2Token(user: User): Promise<string | null> {
  // Check if we have a valid access token
  if (
    user.webhook_oauth2_access_token &&
    user.webhook_oauth2_token_expiry &&
    user.webhook_oauth2_token_expiry > Date.now()
  ) {
    return user.webhook_oauth2_access_token;
  }

  // Try to refresh the token
  if (
    user.webhook_oauth2_refresh_token &&
    user.webhook_oauth2_client_id &&
    user.webhook_oauth2_client_secret &&
    user.webhook_oauth2_token_url
  ) {
    try {
      const tokenResponse = await refreshOAuth2Token(
        user.webhook_oauth2_token_url,
        user.webhook_oauth2_client_id,
        user.webhook_oauth2_client_secret,
        user.webhook_oauth2_refresh_token
      );

      // Update the user's token information
      userDb.updateWebhookAuth(user.id, {
        oauth2_access_token: tokenResponse.access_token,
        oauth2_token_expiry: Date.now() + tokenResponse.expires_in * 1000,
        oauth2_refresh_token:
          tokenResponse.refresh_token || user.webhook_oauth2_refresh_token,
      });

      return tokenResponse.access_token;
    } catch (error) {
      console.error("Failed to refresh OAuth2 token:", error);
      return null;
    }
  }

  // Return existing token even if expired (let the webhook endpoint handle the error)
  return user.webhook_oauth2_access_token;
}

/**
 * Refresh OAuth2 access token
 */
async function refreshOAuth2Token(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  refreshToken: string
): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const params = new URLSearchParams();
  params.append("grant_type", "refresh_token");
  params.append("refresh_token", refreshToken);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);

  const response = await axios.post(tokenUrl, params, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
}

/**
 * Request initial OAuth2 access token using authorization code
 */
export async function requestOAuth2Token(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri?: string
): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const params = new URLSearchParams();
  params.append("grant_type", "authorization_code");
  params.append("code", code);
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  if (redirectUri) {
    params.append("redirect_uri", redirectUri);
  }

  const response = await axios.post(tokenUrl, params, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
}

/**
 * Request OAuth2 access token using client credentials
 */
export async function requestOAuth2ClientCredentials(
  tokenUrl: string,
  clientId: string,
  clientSecret: string,
  scope?: string
): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const params = new URLSearchParams();
  params.append("grant_type", "client_credentials");
  params.append("client_id", clientId);
  params.append("client_secret", clientSecret);
  if (scope) {
    params.append("scope", scope);
  }

  const response = await axios.post(tokenUrl, params, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  return response.data;
}
