import type { ServerConfig } from "../config";
import type { AuthStore } from "./authStore";
import type { ProjectStore } from "./store";
import type { PasswordHasher } from "../auth/password";
import { ensureSuperAdmin } from "../auth/superAdmin";
import type { UserRecord } from "../auth/types";

export interface BootstrapInput {
  config: ServerConfig;
  store: ProjectStore;
  authStore: AuthStore;
  passwordHasher: PasswordHasher;
}

export async function bootstrap({
  config,
  store,
  authStore,
  passwordHasher,
}: BootstrapInput): Promise<UserRecord> {
  const superAdmin = await ensureSuperAdmin({
    authStore,
    passwordHasher,
    email: config.superAdminEmail,
    password: config.superAdminPassword,
    displayName: config.superAdminName,
  });

  store.claimUnownedProjects(superAdmin.id);
  store.migrateLegacyActiveProject(superAdmin.id);

  const now = new Date().toISOString();
  authStore.pruneExpiredSessions(now);
  authStore.pruneExpiredApiTokens(now);

  if (config.seedSamples) {
    store.seedSamples(superAdmin.id);
  }

  return superAdmin;
}

export function resetAllData(store: ProjectStore, authStore: AuthStore): void {
  store.reset();
  authStore.resetAuthData();
}
