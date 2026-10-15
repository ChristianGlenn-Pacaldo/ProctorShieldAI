export type PasswordFeedback = { type: "success" | "error"; text: string };

/** Shared Teacher/Student feedback. Never include submitted values in messages. */
export async function updateAccountPassword(
  role: "teacher" | "student",
  values: { currentPassword: string; newPassword: string; confirmPassword: string },
  request: typeof fetch = fetch,
): Promise<PasswordFeedback> {
  const { currentPassword, newPassword, confirmPassword } = values;
  if (!currentPassword || !newPassword || !confirmPassword) {
    return { type: "error", text: "All password fields are required." };
  }
  if (newPassword !== confirmPassword) return { type: "error", text: "New passwords do not match." };
  if (newPassword.length < 10 || newPassword.length > 128 || !/[A-Za-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    return { type: "error", text: "New password must be 10-128 characters and contain letters and numbers." };
  }
  try {
    const response = await request(`/api/auth/profile?scope=user&role=${role}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword, newPassword }),
    });
    const data = await response.json().catch(() => null);
    if (response.ok && data?.success === true) return { type: "success", text: "Password changed successfully!" };
    if (response.status === 401) return { type: "error", text: "Your session changed or expired. Please sign in again." };
    if (response.status === 400 && data?.message === "Current password is incorrect.") {
      return { type: "error", text: "Current password is incorrect." };
    }
    return { type: "error", text: "Could not update your password. Please try again." };
  } catch {
    return { type: "error", text: "Network error. Please try again." };
  }
}
