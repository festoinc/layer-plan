import type { AuthStore } from "../db/authStore";
import type { PasswordHasher } from "./password";
import type { UserRecord } from "./types";

export interface EnsureSuperAdminInput {
  authStore: AuthStore;
  passwordHasher: PasswordHasher;
  email: string;
  password: string;
  displayName: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueEmailError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /UNIQUE constraint failed: users\.email/i.test(error.message)
  );
}

export async function ensureSuperAdmin(
  input: EnsureSuperAdminInput,
): Promise<UserRecord> {
  const { authStore, passwordHasher } = input;
  const email = normalizeEmail(input.email);
  const displayName = input.displayName.trim() || "Super Admin";
  const existing = authStore.getSuperAdmin();

  try {
    if (!existing) {
      return authStore.createSuperAdmin({
        email,
        displayName,
        passwordHash: await passwordHasher.hash(input.password),
      });
    }

    const emailChanged = existing.email.toLowerCase() !== email;
    const nameChanged = existing.displayName !== displayName;
    if (emailChanged || nameChanged || existing.disabledAt) {
      return authStore.updateSuperAdmin(existing.id, {
        email,
        displayName,
        passwordHash: existing.passwordHash,
      });
    }

    return existing;
  } catch (error) {
    if (isUniqueEmailError(error)) {
      throw new Error(
        `The super-admin email ${email} is already used by another account. Resolve the collision before starting the server.`,
      );
    }
    throw error;
  }
}
