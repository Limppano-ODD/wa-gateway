/**
 * Centralized QR code storage for WhatsApp sessions
 * Stores the latest QR code for sessions that are currently connecting
 */
export const sessionQRCodes = new Map<string, string>();

/**
 * Store a QR code for a session
 */
export function setQRCode(sessionName: string, qr: string): void {
  sessionQRCodes.set(sessionName, qr);
}

/**
 * Get the current QR code for a session
 */
export function getQRCode(sessionName: string): string | undefined {
  return sessionQRCodes.get(sessionName);
}

/**
 * Clear the QR code for a session (usually called when connected)
 */
export function clearQRCode(sessionName: string): void {
  sessionQRCodes.delete(sessionName);
}

/**
 * Check if a session has a QR code stored
 */
export function hasQRCode(sessionName: string): boolean {
  return sessionQRCodes.has(sessionName);
}
