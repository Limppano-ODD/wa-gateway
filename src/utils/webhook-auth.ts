import axios from "axios";
import { User, userDb } from "../database/db";

export interface OAuthTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

export type WebhookAuthType = "none" | "basic" | "oauth" | "bearer";

/**
 * Fetch OAuth token from the configured token endpoint
 * @param username OAuth client ID or username
 * @param password OAuth client secret or password
 * @param tokenUrl OAuth token endpoint URL
 * @param format Format type: 'oauth2' for standard OAuth 2.0, 'json' for JSON username/password
 * @returns OAuth token response
 */
export async function fetchOAuthToken(
  username: string,
  password: string,
  tokenUrl: string,
  format: string = 'oauth2'
): Promise<OAuthTokenResponse> {
  try {
    let response;
    
    if (format === 'json') {
      // JSON format with username/password for custom login endpoints
      console.log(`Fetching token using JSON format (username/password) from ${tokenUrl}`);
      response = await axios.post(
        tokenUrl,
        {
          username,
          password,
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
        }
      );
    } else {
      // Standard OAuth 2.0 client_credentials format
      console.log(`Fetching token using OAuth 2.0 format (client_credentials) from ${tokenUrl}`);
      const params = new URLSearchParams();
      params.append("grant_type", "client_credentials");
      params.append("client_id", username);
      params.append("client_secret", password);

      response = await axios.post(tokenUrl, params, {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      });
    }

    // Handle different response formats
    const data = response.data;
    
    // Standard OAuth format
    if (data.access_token) {
      return data;
    }
    
    // Custom format - check for token in different fields
    if (data.token) {
      return {
        access_token: data.token,
        expires_in: data.expires_in || data.expiresIn,
      };
    }

    // If response has success: true and a data object with token
    if (data.success && data.data?.token) {
      return {
        access_token: data.data.token,
        expires_in: data.data.expires_in || data.data.expiresIn,
      };
    }

    throw new Error(`Unexpected token response format: ${JSON.stringify(data)}`);
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const errorDetails = error.response?.data 
        ? JSON.stringify(error.response.data) 
        : error.message;
      throw new Error(
        `Failed to fetch OAuth token: ${errorDetails}`
      );
    }
    throw error;
  }
}

/**
 * Check if OAuth token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(expirationTime: string | null): boolean {
  if (!expirationTime) return true;

  const expiration = new Date(expirationTime);
  const now = new Date();
  const bufferTime = 5 * 60 * 1000; // 5 minutes buffer

  return expiration.getTime() - now.getTime() < bufferTime;
}

/**
 * Get valid OAuth token for a user, renewing if necessary
 * @param user User object with webhook auth configuration
 * @returns Valid OAuth token or null
 */
export async function getValidOAuthToken(user: User): Promise<string | null> {
  // Check if OAuth is configured
  if (!user.webhook_auth_username || !user.webhook_auth_password || !user.webhook_auth_token_url) {
    console.log(`OAuth not configured for user ${user.username}`);
    return null;
  }

  // Check if token needs renewal
  if (!user.webhook_auth_token || isTokenExpired(user.webhook_auth_token_expiration)) {
    try {
      console.log(`Fetching new OAuth token for user ${user.username} from ${user.webhook_auth_token_url}`);
      
      console.log(`Using username: ${user.webhook_auth_username}`);
      console.log(`Using password: ${user.webhook_auth_password}`);
      console.log(`Using token URL: ${user.webhook_auth_token_url}`);
      
      const format = user.webhook_oauth_format || 'oauth2';
      const tokenResponse = await fetchOAuthToken(
        user.webhook_auth_username,
        user.webhook_auth_password,
        user.webhook_auth_token_url,
        format
      );

      console.log(`OAuth token fetched successfully for user ${user.username}`);

      // Calculate expiration time
      const expiresIn = tokenResponse.expires_in || 3600; // Default to 1 hour
      const expirationTime = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Store new token
      userDb.updateUserWebhookAuth(user.id, {
        webhook_auth_token: tokenResponse.access_token,
        webhook_auth_token_expiration: expirationTime,
      });

      console.log(`OAuth token stored for user ${user.username}, expires at ${expirationTime}`);

      return tokenResponse.access_token;
    } catch (error) {
      console.error(
        `Failed to renew OAuth token for user ${user.username}:`,
        error
      );
      return null;
    }
  }

  console.log(`Using cached OAuth token for user ${user.username}`);
  return user.webhook_auth_token;
}

/**
 * Get authorization headers for webhook based on auth type
 * @param user User with webhook auth configuration
 * @returns Authorization headers object
 */
export async function getWebhookAuthHeaders(user: User | null): Promise<Record<string, string>> {
  if (!user || !user.webhook_auth_type || user.webhook_auth_type === "none") {
    return {};
  }

  const authType = user.webhook_auth_type;

  switch (authType) {
    case "basic":
      // Basic Authentication
      if (user.webhook_auth_username && user.webhook_auth_password) {
        const credentials = Buffer.from(
          `${user.webhook_auth_username}:${user.webhook_auth_password}`
        ).toString("base64");
        return {
          Authorization: `Basic ${credentials}`,
        };
      }
      break;

    case "bearer":
      // Bearer token (static token provided by user)
      if (user.webhook_auth_token) {
        return {
          Authorization: `Bearer ${user.webhook_auth_token}`,
        };
      }
      break;

    case "oauth":
      // OAuth 2.0 with automatic token management
      const token = await getValidOAuthToken(user);
      if (token) {
        return {
          Authorization: `Bearer ${token}`,
        };
      }
      break;
  }

  return {};
}
