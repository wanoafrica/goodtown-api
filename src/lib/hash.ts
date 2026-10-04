/** SHA-256 hex of a normalised login identifier (lower-cased, trimmed). Used for the under-18 denial list. */
export async function identifierHash(identifier: string): Promise<string> {
  const data = new TextEncoder().encode(identifier.trim().toLowerCase())
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
