const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ids in URLs are user input: Postgres rejects a malformed uuid with an error
 * (a 500), so routes check the shape first and answer "not found" instead.
 */
export function isUuid(id: string): boolean {
  return UUID.test(id);
}
