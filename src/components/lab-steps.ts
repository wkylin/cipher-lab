export type LabStepStatus = 'waiting' | 'active' | 'complete' | 'error'

export interface LabStepItem {
  id: string | number
  title: string
  caption?: string
  description?: string
  icon?: string
  /** Defaults to waiting. The caller owns progress and error state. */
  status?: LabStepStatus
}
