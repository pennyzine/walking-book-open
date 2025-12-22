export type MenuSection = "settings" | "comment-studio" | "tape"

export interface MenuOpenOptions {
  section?: MenuSection
  scrollToSection?: MenuSection
}

type MenuController = (options?: MenuOpenOptions) => boolean

const controllers: MenuController[] = []

export function registerMenuController(controller: MenuController) {
  controllers.push(controller)
  return () => {
    const index = controllers.indexOf(controller)
    if (index !== -1) {
      controllers.splice(index, 1)
    }
  }
}

export function openMenuPanel(options?: MenuOpenOptions) {
  // Prefer the most recently mounted *visible* controller. Some pages render
  // both mobile + desktop menus and hide one with CSS (display: none), which
  // would otherwise "eat" open requests.
  for (let i = controllers.length - 1; i >= 0; i--) {
    const controller = controllers[i]
    if (!controller) continue
    if (controller(options)) return true
  }
  return false
}

export function openSettingsPanel() {
  return openMenuPanel({ section: "settings", scrollToSection: "settings" })
}

export function openCommentStudioPanel() {
  return openMenuPanel({ section: "comment-studio", scrollToSection: "comment-studio" })
}
