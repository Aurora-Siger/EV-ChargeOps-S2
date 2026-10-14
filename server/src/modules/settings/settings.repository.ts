import { eq } from 'drizzle-orm'
import { db } from '../../infra/db/client.js'
import { condoSettings, workspace } from '../../infra/db/schema.js'

export type CondoSettingsRow = typeof condoSettings.$inferSelect
export type CondoSettingsValues = Omit<CondoSettingsRow, 'workspaceId' | 'updatedAt'>
export type CondoSettingsPatch = Partial<CondoSettingsValues>

export const settingsRepository = {
  /** Configurações do condomínio, com o nome dele (que mora no workspace). */
  find: async (workspaceId: string) =>
    (
      await db
        .select({ settings: condoSettings, name: workspace.name })
        .from(condoSettings)
        .innerJoin(workspace, eq(workspace.id, condoSettings.workspaceId))
        .where(eq(condoSettings.workspaceId, workspaceId))
        .limit(1)
    )[0] ?? null,
  insertIfMissing: (workspaceId: string, values: CondoSettingsValues) =>
    db.insert(condoSettings).values({ workspaceId, ...values }).onConflictDoNothing(),
  update: (workspaceId: string, patch: CondoSettingsPatch) =>
    db.update(condoSettings).set(patch).where(eq(condoSettings.workspaceId, workspaceId)),
  rename: (workspaceId: string, name: string) => db.update(workspace).set({ name }).where(eq(workspace.id, workspaceId)),
}
