import type { VoiceEdit } from "@/types/audiobook"

export const VALID_EDIT_TYPES: ReadonlyArray<VoiceEdit["editType"]> = ["last-line", "last-paragraph", "custom"]

export function getEditTypeLabel(editType: VoiceEdit["editType"]): string {
  switch (editType) {
    case "last-line":
      return "Line Edit"
    case "last-paragraph":
      return "Section Edit"
    case "custom":
      return "Dev Edit"
    default:
      return editType
  }
}
