import { z } from "zod";
import { PROJECT_COLORS } from "../../src/domain/projects";
import { VERIFICATION_MODES } from "../../src/domain/verificationTypes";
import { ApiError, zodDetails } from "./errors";

const idSchema = z.string().min(1).max(128);

export const verificationSchema = z
  .object({
    mode: z.enum(VERIFICATION_MODES),
    auto: z.object({ command: z.string().max(500) }).strict(),
    human: z.object({ instructions: z.string().max(2000) }).strict(),
    ai: z.object({ instructions: z.string().max(4000) }).strict(),
  })
  .strict();

export const criterionSchema = z
  .object({
    id: idSchema,
    text: z.string().max(20000),
    checked: z.boolean(),
    chapterId: idSchema.optional(),
  })
  .strict();

export const chapterSchema = z
  .object({
    id: idSchema,
    parentId: z.string().max(128).nullable(),
    title: z.string().max(200),
    description: z.string().max(100000),
    finalLevel: z.boolean(),
    verification: verificationSchema,
    criteria: z.array(criterionSchema).max(500),
    childIds: z.array(z.string().min(1).max(128)).max(5000),
  })
  .strict();

export const documentSchema = z
  .object({
    byId: z.record(z.string().min(1).max(128), chapterSchema),
    rootIds: z.array(z.string().min(1).max(128)).max(5000),
  })
  .strict();

export const activityInputSchema = z
  .object({
    id: idSchema,
    message: z.string().min(1).max(1000),
    chapterId: z.string().max(128).nullable().optional(),
    chapterName: z.string().max(200).optional(),
  })
  .strict();

export const putDocumentSchema = z
  .object({
    chapters: documentSchema,
    selectedId: z.string().max(128).nullable(),
    activity: z.array(activityInputSchema).max(100).optional(),
  })
  .strict();

const projectBase = {
  name: z.string().trim().min(1).max(80),
  initials: z.string().max(2).optional(),
  color: z.enum(PROJECT_COLORS).optional(),
  description: z.string().max(280).optional(),
  testGuidelines: z.string().max(8000).optional(),
};

export const createProjectSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{1,64}$/)
      .optional(),
    ...projectBase,
  })
  .strict();

export const updateProjectSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    initials: z.string().max(2).optional(),
    color: z.enum(PROJECT_COLORS).optional(),
    description: z.string().max(280).optional(),
    testGuidelines: z.string().max(8000).optional(),
  })
  .strict();

export const appendActivitySchema = z
  .object({
    message: z.string().trim().min(1).max(1000),
    chapterId: z.string().max(128).nullable().optional(),
    chapterName: z.string().max(200).optional(),
  })
  .strict();

export const activityQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).optional(),
    before: z.coerce.number().int().positive().optional(),
  })
  .strict();

export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ApiError(
      422,
      "validation_failed",
      "The request did not match the API contract.",
      zodDetails(result.error),
    );
  }
  return result.data;
}

export function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  return parseBody(schema, query);
}
