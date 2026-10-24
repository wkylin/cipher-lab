export interface SelectOption<T extends string | number = string | number> {
  value: T
  label: string
  description?: string
  disabled?: boolean
}
