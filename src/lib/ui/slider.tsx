import { Slider as ShadcnSlider, type SliderProps } from '@effectweb/shadcn/slider'
import { view } from 'effectweb'
export type { SliderProps }
export const Slider = view<SliderProps>((props) => (
  <ShadcnSlider
    {...props}
    onInput={(event) => {
      props.onInput?.(event)
      if (!event.defaultPrevented) props.onValueChange?.(event.currentTarget.valueAsNumber)
    }}
  />
))
