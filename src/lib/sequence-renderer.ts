import type { Mermaid } from 'mermaid'

let engine: Promise<Mermaid> | undefined
let renderId = 0
const instance = crypto.randomUUID().replaceAll('-', '')

// Only load Mermaid when the diagram page opens. No CDN or remote rendering service.
async function getEngine() {
  if (!engine) {
    engine = import('mermaid').then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        theme: 'base',
        fontFamily: 'Avenir Next, PingFang SC, Microsoft YaHei, sans-serif',
        themeVariables: {
          darkMode: true,
          background: '#081522',
          primaryColor: '#143246',
          primaryTextColor: '#dceaf4',
          primaryBorderColor: '#438397',
          lineColor: '#7eacc0',
          secondaryColor: '#102637',
          tertiaryColor: '#102637',
          actorBkg: '#143246',
          actorBorder: '#438397',
          actorTextColor: '#dceaf4',
          actorLineColor: '#3b6074',
          signalColor: '#8bc4d5',
          signalTextColor: '#cfdee9',
          labelBoxBkgColor: '#173044',
          labelBoxBorderColor: '#426179',
          labelTextColor: '#c1d5e4',
          loopTextColor: '#adc7d9',
          noteBkgColor: '#142b3d',
          noteBorderColor: '#36576e',
          noteTextColor: '#b7cfdf',
          activationBkgColor: '#1c4a5e',
          activationBorderColor: '#438397',
          sequenceNumberColor: '#07111f',
        },
        sequence: {
          useMaxWidth: false,
          // Mermaid 11.17.2 leaves live actor lines at y2=2000 without footer actors.
          // Mirroring computes their endpoints from the final diagram height and
          // repeats column labels at the bottom of long diagrams (also in exports).
          mirrorActors: true,
          actorMargin: 38,
          width: 146,
          height: 52,
          boxMargin: 12,
          boxTextMargin: 12,
          diagramMarginX: 24,
          diagramMarginY: 24,
          messageMargin: 36,
          noteMargin: 16,
          actorFontSize: 14,
          messageFontSize: 14,
          noteFontSize: 13,
          wrap: true,
        },
      })
      return mermaid
    }).catch((error: unknown) => {
      engine = undefined
      throw error
    })
  }
  return engine
}

export async function renderSequence(source: string) {
  const mermaid = await getEngine()
  const { svg } = await mermaid.render(`cipher-sequence-${instance}-${++renderId}`, source)
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
  const root = document.documentElement
  const box = root.getAttribute('viewBox')?.split(/[\s,]+/).map(Number)
  if (document.querySelector('parsererror') || !box || box.length !== 4 || !box.every(Number.isFinite) || box[2]! <= 0) {
    throw new Error('时序图尺寸解析失败')
  }
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  root.setAttribute('width', String(box[2]))
  root.setAttribute('height', String(box[3]))
  // Keep the exported SVG self-contained, with the same dark canvas as the preview.
  root.setAttribute('style', 'display:block;width:100%;height:auto;max-width:none;background:#081522;')
  return { svg: root.outerHTML, width: box[2]! }
}
