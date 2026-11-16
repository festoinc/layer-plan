import { hash, hashSync, verify } from "@node-rs/argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(passwordHash: string, password: string): Promise<boolean>;
  verifyDummy(password: string): Promise<boolean>;
}

const PRODUCTION_OPTIONS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

const TEST_OPTIONS = {
  memoryCost: 4096,
  timeCost: 1,
  parallelism: 1,
};

export function createPasswordHasher(
  options: {
    testMode?: boolean;
  } = {},
): PasswordHasher {
  const argonOptions = options.testMode ? TEST_OPTIONS : PRODUCTION_OPTIONS;
  const dummyHash = hashSync("layers-dummy-password", argonOptions);

  return {
    hash(password) {
      return hash(password, argonOptions);
    },
    verify(passwordHash, password) {
      return verify(passwordHash, password);
    },
    async verifyDummy(password) {
      await verify(dummyHash, password);
      return false;
    },
  };
}
