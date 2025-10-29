import axios from "axios";
import { User, userDb } from "../database/db";

export interface OAuthTokenResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

/**
 * Fetch OAuth token from the webhook's OAuth endpoint
 * @param oauthLogin OAuth client ID or username
 * @param oauthPassword OAuth client secret or password
 * @param tokenUrl OAuth token endpoint URL
 * @returns OAuth token response
 */
export async function fetchOAuthToken(
  oauthLogin: string,
  oauthPassword: string,
  tokenUrl: string
): Promise<OAuthTokenResponse> {
  try {
    // Use URLSearchParams for standard OAuth 2.0 form-encoded format
    const params = new URLSearchParams();
    params.append("grant_type", "client_credentials");
    params.append("client_id", oauthLogin);
    params.append("client_secret", oauthPassword);

    const response = await axios.post(tokenUrl, params, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(
        `Failed to fetch OAuth token: ${error.response?.data?.error || error.message}`
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
 * @param user User object with OAuth configuration
 * @param tokenUrl OAuth token endpoint URL
 * @returns Valid OAuth token
 */
export async function getValidOAuthToken(
  user: User,
  tokenUrl: string
): Promise<string | null> {
  // Check if OAuth is configured
  if (!user.oauth_login || !user.oauth_password) {
    return null;
  }

  // Check if token needs renewal
  if (!user.oauth_token || isTokenExpired(user.oauth_token_expiration)) {
    try {
      const tokenResponse = await fetchOAuthToken(
        user.oauth_login,
        user.oauth_password,
        tokenUrl
      );

      // Calculate expiration time
      const expiresIn = tokenResponse.expires_in || 3600; // Default to 1 hour
      const expirationTime = new Date(Date.now() + expiresIn * 1000).toISOString();

      // Store new token
      userDb.updateUserOAuthConfig(user.id, {
        oauth_token: tokenResponse.access_token,
        oauth_token_expiration: expirationTime,
      });

      return tokenResponse.access_token;
    } catch (error) {
      console.error(
        `Failed to renew OAuth token for user ${user.username}:`,
        error
      );
      return null;
    }
  }

  return user.oauth_token;
}

/**
 * Extract OAuth token URL from callback URL
 * Convention: If callback URL is https://example.com/webhook, 
 * OAuth token URL is https://example.com/oauth/token
 */
export function getOAuthTokenUrl(callbackUrl: string): string {
  try {
    const url = new URL(callbackUrl);
    return `${url.origin}/oauth/token`;
  } catch (error) {
    // Fallback: append /oauth/token to the callback URL
    const baseUrl = callbackUrl.replace(/\/+$/, ""); // Remove trailing slashes
    return `${baseUrl}/oauth/token`;
  }
}
