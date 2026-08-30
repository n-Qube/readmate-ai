import { describe, expect, it } from "vitest";
import { getProfileFirstName } from "./profile-name";

describe("getProfileFirstName", () => {
  it("uses a single first name as-is", () => {
    expect(getProfileFirstName("Daniel", "Daniel Nii Nortey")).toBe("Daniel");
  });

  it("extracts only the first token when Clerk's firstName contains a full name", () => {
    expect(getProfileFirstName("  Daniel Nii Nortey  ", "Daniel Nii Nortey")).toBe("Daniel");
  });

  it("falls back to the first token of fullName", () => {
    expect(getProfileFirstName(null, "Ama Serwaa Doe")).toBe("Ama");
  });

  it("returns an empty string when the profile has no name", () => {
    expect(getProfileFirstName(null, "   ")).toBe("");
  });
});
