import * as React from "react"

const MOBILE_BREAKPOINT = 768
const PHONE_BREAKPOINT = 600
const DESKTOP_BREAKPOINT = 1024

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

export type Viewport = "mobile" | "tablet" | "desktop"

function computeViewport(): Viewport {
  if (typeof window === "undefined") return "desktop"
  const w = window.innerWidth
  if (w < PHONE_BREAKPOINT) return "mobile"
  if (w < DESKTOP_BREAKPOINT) return "tablet"
  return "desktop"
}

/**
 * Reactive viewport bucket. Used by the studio shell to pick between
 * the full desktop layout, the tablet layout (drawers for side panels),
 * and the mobile performance/sketch shell.
 */
export function useViewport(): Viewport {
  const [v, setV] = React.useState<Viewport>(() => computeViewport())
  React.useEffect(() => {
    const onResize = () => setV(computeViewport())
    window.addEventListener("resize", onResize)
    window.addEventListener("orientationchange", onResize)
    return () => {
      window.removeEventListener("resize", onResize)
      window.removeEventListener("orientationchange", onResize)
    }
  }, [])
  return v
}
