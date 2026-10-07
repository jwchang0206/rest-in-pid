import type { ClientModule } from 'claude-code'

/**
 * A see-through region laid over a section's drawn heading, so the whole
 * strip toggles its section: an Svg takes no press, and a Button would draw
 * its own chrome over the design. A click, or Enter once it has the focus,
 * tells the hooks module which section to open or close.
 */
const Press: ClientModule<{ section: string }, true> = (props, surface) => {
  if (surface.state === undefined) {
    const toggle = () => surface.post({ toggle: props.section })
    // A press lands on the button going down, which only happens inside the region.
    surface.onPointer(event => {
      if (event.type === 'down' && event.button === 'left') toggle()
    })
    surface.onKey(event => {
      if (event.key === 'return' || event.key === ' ') toggle()
    })
    surface.setState(true)
  }
  const { Box } = surface.elements
  return <Box width="100%" height="100%" />
}

export default Press
