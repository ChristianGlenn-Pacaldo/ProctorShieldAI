/** Only display a bounded server-generated UUID, never arbitrary response header content. */
export function responseRequestId(response: Pick<Response, "headers">): string | null {
 const value = response.headers?.get("X-Request-ID");
 return value && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
