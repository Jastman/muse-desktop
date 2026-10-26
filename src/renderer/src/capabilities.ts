import type { MuseModel, ReasoningEffort } from '../../shared/protocol'
import type { SelectOption } from './components/Select'

export const efforts: ReasoningEffort[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
]

export const effortLabel = (effort: string) =>
  effort === 'xhigh' ? 'Extra high' : effort[0].toUpperCase() + effort.slice(1)

export type EffortCapability = {
  options: SelectOption[]
  /** Explains how trustworthy the list is. */
  note: string
  /** Set when the chosen effort is known to be unsupported by the current model. */
  warning?: string
  known: boolean
}

/**
 * Effort choices derived from what the CLI reports for the model. Only an explicit `variants`
 * list is treated as authoritative; `unknown` or missing data is explained, never advertised.
 */
export function effortCapability(
  model: MuseModel | undefined,
  selected: ReasoningEffort,
): EffortCapability {
  const name = model?.displayLabel || model?.modelId || 'this model'
  if (!model || model.variants === undefined || model.variants === 'unknown') {
    return {
      known: false,
      note: !model
        ? 'Muse Code has not reported the current model. Effort is a request; the CLI decides how to apply it.'
        : model.variants === 'unknown'
          ? `${name} does not report which effort levels it supports. Your choice is sent as a request and may be ignored.`
          : `This Muse Code version does not report effort support for ${name}. Your choice is sent as a request and may be ignored.`,
      options: efforts.map((effort) => ({ value: effort, label: effortLabel(effort) })),
    }
  }
  const supported = new Set(model.variants)
  const descriptions = new Map(
    (model.reasoningEffortVariants ?? []).map((variant) => [variant.tier, variant.description]),
  )
  const unsupportedSelected = !supported.has(selected)
  return {
    known: true,
    note: `Levels ${name} reports as supported.${model.defaultReasoningEffort ? ` Default: ${effortLabel(model.defaultReasoningEffort)}.` : ''}`,
    warning: unsupportedSelected
      ? `${effortLabel(selected)} effort is not supported by ${name}. Choose a supported level before sending.`
      : undefined,
    options: efforts
      .filter((effort) => supported.has(effort) || effort === selected)
      .map((effort) => ({
        value: effort,
        label: effortLabel(effort),
        description: supported.has(effort)
          ? descriptions.get(effort) ||
            (effort === model.defaultReasoningEffort ? 'Model default' : undefined)
          : 'Not supported by this model',
        disabled: !supported.has(effort),
      })),
  }
}
