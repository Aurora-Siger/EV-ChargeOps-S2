import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        alt?: string
        'camera-controls'?: boolean
        'auto-rotate'?: boolean
        'auto-rotate-delay'?: string
        'rotation-per-second'?: string
        'disable-zoom'?: boolean
        'disable-pan'?: boolean
        exposure?: string
        'shadow-intensity'?: string
        'shadow-softness'?: string
        'environment-image'?: string
        'tone-mapping'?: string
        'camera-orbit'?: string
        'field-of-view'?: string
        'min-field-of-view'?: string
        'max-field-of-view'?: string
        'min-camera-orbit'?: string
        'max-camera-orbit'?: string
        'interaction-prompt'?: string
        loading?: string
        reveal?: string
      }
    }
  }
}

export {}
