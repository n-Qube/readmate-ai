export function getProfileFirstName(firstName?: string | null, fullName?: string | null): string {
  const profileName = firstName?.trim() || fullName?.trim() || "";
  return profileName.split(/\s+/u)[0] ?? "";
}
