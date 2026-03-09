/**
 * Encoding utilities for x402 protocol
 */

/**
 * Encode data to base64 (works in both Node.js and browser)
 */
export function encodeBase64(data: string | Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    if (typeof data === 'string') {
      return Buffer.from(data, 'utf-8').toString('base64');
    }
    return Buffer.from(data).toString('base64');
  }
  if (typeof data === 'string') {
    return globalThis.btoa(data);
  }
  return globalThis.btoa(String.fromCharCode(...data));
}

/**
 * Decode base64 to string (works in both Node.js and browser)
 */
export function decodeBase64(data: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(data, 'base64').toString('utf-8');
  }
  return globalThis.atob(data);
}

/**
 * Decode base64 to Uint8Array
 */
export function decodeBase64ToBytes(data: string): Uint8Array {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(data, 'base64'));
  }
  const binary = globalThis.atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encode an object to JSON string
 */
export function encodeJSON(data: unknown): string {
  return JSON.stringify(data);
}

/**
 * Decode a JSON string to object
 */
export function decodeJSON<T = any>(data: string): T {
  return JSON.parse(data) as T;
}

/**
 * Encode payment payload to base64 for HTTP header
 */
export function encodePaymentPayload(payload: unknown): string {
  const json = JSON.stringify(payload);
  return encodeBase64(json);
}

/**
 * Decode payment payload from base64 HTTP header
 */
export function decodePaymentPayload<T>(encoded: string): T {
  const json = decodeBase64(encoded);
  return JSON.parse(json) as T;
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string
 */
export function bytesToHex(bytes: Uint8Array, prefix = true): string {
  const hex = Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
  return prefix ? `0x${hex}` : hex;
}

/**
 * Convert payment ID from hex string to bytes16 for EIP-712 signing
 * 
 * @param paymentId - Hex string with 0x prefix (e.g., "0x1234...abcd")
 * @returns 16-byte Uint8Array
 * @throws Error if format is invalid
 */
export function paymentIdToBytes(paymentId: string): Uint8Array {
  if (!paymentId.startsWith('0x')) {
    throw new Error(`Invalid payment ID format: ${paymentId}. Expected hex string with 0x prefix`);
  }
  
  const paymentIdHex = paymentId.slice(2);
  if (paymentIdHex.length !== 32) {
    throw new Error(`Invalid payment ID length: ${paymentIdHex.length}. Expected 32 hex characters (16 bytes)`);
  }
  
  return hexToBytes(paymentId);
}
