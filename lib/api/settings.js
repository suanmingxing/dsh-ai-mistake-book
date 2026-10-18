/**
 * Settings-facing API methods.
 *
 * The editable prompts and the PDF export defaults are the only user-configurable
 * content of the plugin; both are persisted under the archive root (prompt files in
 * `templates/`, export defaults in `export-settings.json`) and surfaced here so the
 * Settings page never talks to the filesystem directly.
 *
 * The legacy `customTemplate*` layer was removed: customization now means editing
 * the default prompts. `templates` still runs the one-time migration of an old
 * `templates/custom.json` and reports it back.
 */
import { DEFAULT_EXPORT_SETTINGS, orderedSections, readExportSettings, writeExportSettings } from '../export-settings.js'
import { SYSTEM_SUFFIX } from '../prompt.js'
import { DEFAULT_TEMPLATES, ensureTemplates, readTemplates, writeTemplate, writeTemplates } from '../templates.js'

/** Editable prompts + built-in defaults + the read-only system suffix. */
export async function templates(payload, { paths }) {
  const { migrated } = await ensureTemplates(paths)
  const editable = await readTemplates(paths)
  return {
    templates: editable,
    defaults: DEFAULT_TEMPLATES,
    dir: paths.templates,
    systemSuffix: SYSTEM_SUFFIX,
    migrated,
  }
}

/** Overwrite one built-in template (kept for older clients and scripts). */
export async function templateSave(payload, { paths }) {
  const file = await writeTemplate(paths, String(payload.key), String(payload.content ?? ''))
  return { saved: true, file }
}

/** Save every edited prompt block in one request (the Settings page save-all). */
export async function templateSaveAll(payload, { paths }) {
  const saved = await writeTemplates(paths, payload ?? {})
  return { saved, dir: paths.templates }
}

/** Export-PDF defaults plus the section catalogue, already in the user's order. */
export async function exportSettings(payload, { paths }) {
  const settings = await readExportSettings(paths)
  return { settings, sections: orderedSections(settings), defaults: DEFAULT_EXPORT_SETTINGS }
}

/** Persist export-PDF defaults (section toggles, order, source options). */
export async function exportSettingsSave(payload, { paths }) {
  return { settings: await writeExportSettings(paths, payload) }
}
