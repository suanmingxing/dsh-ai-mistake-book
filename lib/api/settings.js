/**
 * Settings-facing API methods.
 *
 * The editable prompts, the user's custom templates and the PDF export defaults are
 * the only user-configurable content of the plugin; all are persisted under the
 * archive root (`templates/` files, `custom-templates.json`, `export-settings.json`)
 * and surfaced here so the Settings page never talks to the filesystem directly.
 *
 * Custom templates are PDF/card sections (not prompt blocks): `templates` ships them
 * for editing, `exportSettings` merges them into the section catalogue/order, and
 * `exportSettingsSave` normalizes the order against the ids that currently exist.
 *
 * `templates` also runs the one-time migration of the old (v0.1.0)
 * `templates/custom.json` into analysis.md and reports it back.
 */
import {
  defaultExportSettings,
  orderedSections,
  readExportSettings,
  sectionCatalogue,
  writeExportSettings,
} from '../export-settings.js'
import { SYSTEM_SUFFIX } from '../prompt.js'
import {
  DEFAULT_TEMPLATES,
  TEMPLATE_META,
  ensureTemplates,
  readCustomTemplates,
  readTemplates,
  saveCustomTemplates,
  writeTemplate,
  writeTemplates,
} from '../templates.js'

/** Editable prompts + defaults/meta + custom templates + the read-only system suffix. */
export async function templates(payload, { paths }) {
  const { migrated } = await ensureTemplates(paths)
  const { custom, ...editable } = await readTemplates(paths)
  return {
    templates: editable,
    defaults: DEFAULT_TEMPLATES,
    meta: TEMPLATE_META,
    custom,
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

/** Replace the whole custom-template list (add/edit/delete/enable in one request). */
export async function customTemplatesSaveAll(payload, { paths }) {
  const items = await saveCustomTemplates(paths, payload?.items)
  return { items }
}

/**
 * Export-PDF settings: the saved order (presets + every existing `tpl:<id>`), the
 * section catalogue **already in that order** (so the Settings page renders one
 * unified list), and the dynamic defaults for the current custom templates.
 */
export async function exportSettings(payload, { paths }) {
  const custom = await readCustomTemplates(paths)
  const customIds = custom.map((item) => item.id)
  const settings = await readExportSettings(paths, customIds)
  return {
    settings,
    sections: orderedSections(settings, sectionCatalogue(custom)),
    defaults: defaultExportSettings(customIds),
  }
}

/** Persist export-PDF defaults (section toggles, order, source options). */
export async function exportSettingsSave(payload, { paths }) {
  const customIds = (await readCustomTemplates(paths)).map((item) => item.id)
  return { settings: await writeExportSettings(paths, payload, customIds) }
}
