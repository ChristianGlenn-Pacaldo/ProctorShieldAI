type GoogleIdentityPayload = {
  email?: string | null;
  email_verified?: boolean | null;
};

export function hasVerifiedGoogleEmail<T extends GoogleIdentityPayload>(
  payload: T | null | undefined,
): payload is T & { email: string; email_verified: true } {
  return Boolean(
    payload
    && typeof payload.email === "string"
    && payload.email.trim().length > 0
    && payload.email_verified === true,
  );
}
