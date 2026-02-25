'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

type State = {
  baseId: string
  noseId: string | null
  eyesId: string | null
  accIds: string[]
  luckyUnlocked: boolean
}

const pad2 = (n: number) => String(n).padStart(2, '0')

// Visible defaults
const BASE_DEFAULT = Array.from({ length: 6 }, (_, i) => `base-${pad2(i + 1)}`) // 01–06
const NOSE_DEFAULT = Array.from({ length: 6 }, (_, i) => `nose-${pad2(i + 1)}`) // 01–06
const EYES = Array.from({ length: 4 }, (_, i) => `eyes-${pad2(i + 1)}`) // 01–04
const ACC = Array.from({ length: 22 }, (_, i) => `acc-${pad2(i + 1)}`) // 01–22

const BASE_LUCKY = 'base-07'
const NOSE_LUCKY = 'nose-07'

const src = {
  base: (id: string) => `/assets/base/${id}.png`,
  nose: (id: string) => `/assets/nose/${id}.png`,
  eyes: (id: string) => `/assets/eyes/${id}.png`,
  acc: (id: string) => `/assets/acc/${id}.png`,
  ui: (name: 'box-closed' | 'box-open') => `/assets/ui/${name}.png`
}

const defaultState: State = {
  baseId: 'base-01',
  noseId: null,
  eyesId: null,
  accIds: [],
  luckyUnlocked: false
}

function pickOne<T>(arr: T[]) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function uniqueSample<T>(arr: T[], count: number) {
  const copy = [...arr]
  const out: T[] = []
  while (copy.length && out.length < count) {
    const idx = Math.floor(Math.random() * copy.length)
    out.push(copy[idx])
    copy.splice(idx, 1)
  }
  return out
}

const loadImage = (path: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = path
  })

function DownloadIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 3v10m0 0 4-4m-4 4-4-4M5 21h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 5v14M5 12h14"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}

type AlphaFocus = { x: number; y: number; scale: number }
const alphaFocusCache = new Map<string, AlphaFocus>()

async function computeAlphaFocus(imageSrc: string): Promise<AlphaFocus> {
  if (alphaFocusCache.has(imageSrc)) return alphaFocusCache.get(imageSrc)!

  const img = await loadImage(imageSrc)
  const w = img.naturalWidth || 2048
  const h = img.naturalHeight || 2048

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    const fallback = { x: 0.5, y: 0.5, scale: 1.5 }
    alphaFocusCache.set(imageSrc, fallback)
    return fallback
  }

  ctx.clearRect(0, 0, w, h)
  ctx.drawImage(img, 0, 0, w, h)
  const data = ctx.getImageData(0, 0, w, h).data

  const step = 3
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0
  let found = false

  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      if (a > 8) {
        found = true
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }

  if (!found) {
    const fallback = { x: 0.5, y: 0.5, scale: 1.5 }
    alphaFocusCache.set(imageSrc, fallback)
    return fallback
  }

  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const bw = Math.max(1, maxX - minX)
  const bh = Math.max(1, maxY - minY)

  const targetFill = 0.78
  const sx = targetFill / (bw / w)
  const sy = targetFill / (bh / h)
  let scale = Math.min(sx, sy)
  scale = Math.max(1.05, Math.min(scale, 3.2))

  const focus: AlphaFocus = { x: cx / w, y: cy / h, scale }
  alphaFocusCache.set(imageSrc, focus)
  return focus
}

function transformFromFocus(f: AlphaFocus) {
  const tx = 50 - f.scale * f.x * 100
  const ty = 50 - f.scale * f.y * 100
  return `translate(${tx}%, ${ty}%) scale(${f.scale})`
}

type LuckyPhase = 'idle' | 'enter' | 'calibrate' | 'open' | 'revealNo' | 'revealYes' | 'exit'

export default function BuildABubu() {
  // Clean refresh default: base-01 only
  const [state, setState] = useState<State>(defaultState)
  const [note, setNote] = useState('')
  const [luckyPhase, setLuckyPhase] = useState<LuckyPhase>('idle')
  const [forceLuckyWin, setForceLuckyWin] = useState(false)

  const [open, setOpen] = useState({
    base: true,
    nose: false,
    eyes: false,
    acc: false
  })

  const luckyTimers = useRef<number[]>([])
  const [luckyLatchedOpen, setLuckyLatchedOpen] = useState(false)

  const headerRef = useRef<HTMLElement | null>(null)
  const [desktopBodyH, setDesktopBodyH] = useState<number | null>(null)

  useEffect(() => {
    const measure = () => {
      const hh = headerRef.current?.getBoundingClientRect().height ?? 0
      setDesktopBodyH(Math.max(0, window.innerHeight - hh))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  useEffect(() => {
    if (!note) return
    const t = window.setTimeout(() => setNote(''), 1400)
    return () => window.clearTimeout(t)
  }, [note])

  const baseOptions = useMemo(() => {
    const ids = [...BASE_DEFAULT]
    if (state.luckyUnlocked) ids.push(BASE_LUCKY)
    return ids
  }, [state.luckyUnlocked])

  const noseOptions = useMemo(() => {
    const ids = [...NOSE_DEFAULT]
    if (state.luckyUnlocked) ids.push(NOSE_LUCKY)
    return ids
  }, [state.luckyUnlocked])

  const toggleAcc = (id: string) => {
    setState(s => {
      const has = s.accIds.includes(id)
      return { ...s, accIds: has ? s.accIds.filter(x => x !== id) : [...s.accIds, id] }
    })
  }

  const clearNose = () => setState(s => ({ ...s, noseId: null }))
  const clearEyes = () => setState(s => ({ ...s, eyesId: null }))
  const clearAcc = () => setState(s => ({ ...s, accIds: [] }))
  const clearAll = () =>
    setState({
      ...defaultState,
      luckyUnlocked: state.luckyUnlocked
    })

  const onBuildForMe = () => {
    setState(s => {
      const bases = s.luckyUnlocked ? [...BASE_DEFAULT, BASE_LUCKY] : [...BASE_DEFAULT]
      const noses = s.luckyUnlocked ? [...NOSE_DEFAULT, NOSE_LUCKY] : [...NOSE_DEFAULT]

      const roll = Math.random()
      const count =
        roll < 0.6 ? Math.floor(Math.random() * 2)
        : roll < 0.88 ? 2 + Math.floor(Math.random() * 2)
        : 4 + Math.floor(Math.random() * 4)

      return {
        ...s,
        baseId: pickOne(bases),
        noseId: Math.random() < 0.9 ? pickOne(noses) : null,
        eyesId: Math.random() < 0.9 ? pickOne(EYES) : null,
        accIds: uniqueSample(ACC, Math.min(count, ACC.length))
      }
    })
  }

  const clearLuckyTimers = () => {
    luckyTimers.current.forEach(t => window.clearTimeout(t))
    luckyTimers.current = []
  }

  const closeLucky = () => {
    clearLuckyTimers()
    setOpen(s => ({ ...s, base: true }))
    setLuckyPhase('exit')
    const t = window.setTimeout(() => {
      setLuckyPhase('idle')
      setLuckyLatchedOpen(false)
    }, 260)
    luckyTimers.current.push(t)
  }

  const onLucky = () => {
    if (luckyPhase !== 'idle') return

    const chance = 0.02
    const hit = forceLuckyWin ? true : Math.random() < chance

    setLuckyPhase('enter')
    setLuckyLatchedOpen(false)
    clearLuckyTimers()

    luckyTimers.current.push(window.setTimeout(() => setLuckyPhase('calibrate'), 850))
    luckyTimers.current.push(window.setTimeout(() => setLuckyPhase('open'), 3600))
    luckyTimers.current.push(
      window.setTimeout(() => {
        setLuckyPhase(hit ? 'revealYes' : 'revealNo')
        if (hit) setLuckyLatchedOpen(true)
      }, 3800)
    )

    if (hit) {
      luckyTimers.current.push(
        window.setTimeout(() => {
          setState(s => ({
            ...s,
            luckyUnlocked: true,
            baseId: BASE_LUCKY,
            noseId: NOSE_LUCKY
          }))
        }, 3950)
      )
      luckyTimers.current.push(window.setTimeout(() => closeLucky(), 8200))
    } else {
      luckyTimers.current.push(window.setTimeout(() => closeLucky(), 7800))
    }
  }

  const onDownload = async () => {
    try {
      const size = 2048
      const canvas = document.createElement('canvas')
      canvas.width = size
      canvas.height = size
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, size, size)

      const layers: string[] = [src.base(state.baseId)]
      if (state.noseId) layers.push(src.nose(state.noseId))
      if (state.eyesId) layers.push(src.eyes(state.eyesId))
      layers.push(...state.accIds.map(src.acc))

      const imgs = await Promise.all(layers.map(loadImage))
      for (const img of imgs) ctx.drawImage(img, 0, 0, size, size)

      canvas.toBlob(blob => {
        if (!blob) return
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = 'build-a-bubu.png'
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
      }, 'image/png')

      setNote('DOWNLOADED')
    } catch {
      setNote('DOWNLOAD FAILED')
    }
  }

  function Tile({
    id,
    imageSrc,
    selected,
    onClick,
    mega = false,
    kind
  }: {
    id: string
    imageSrc: string
    selected: boolean
    onClick: () => void
    mega?: boolean
    kind?: 'nose' | 'eyes' | 'acc'
  }) {
    const [focus, setFocus] = useState<AlphaFocus | null>(null)

    useEffect(() => {
      let mounted = true
      if (!mega) return

      computeAlphaFocus(imageSrc)
        .then(f => {
          if (!mounted) return
          if (kind === 'nose') {
            const boosted = { ...f, scale: Math.min(Math.max(f.scale * 1.85, 1.4), 4.8) }
            setFocus(boosted)
          } else {
            setFocus(f)
          }
        })
        .catch(() => {
          if (!mounted) return
          setFocus({ x: 0.5, y: 0.5, scale: kind === 'nose' ? 2.9 : 1.6 })
        })

      return () => { mounted = false }
    }, [imageSrc, mega, kind])

    return (
      <button
        type="button"
        onClick={onClick}
        className={[
          'group relative aspect-square w-full overflow-hidden bg-transparent',
          'ring-1',
          selected ? 'ring-black' : 'ring-transparent',
          selected ? '' : 'hover:ring-black/20'
        ].join(' ')}
        aria-pressed={selected}
        title={id}
      >
        <img
          src={imageSrc}
          alt={id}
          draggable={false}
          className="absolute left-0 top-0 h-full w-full object-contain"
          style={mega && focus ? { transformOrigin: '0 0', transform: transformFromFocus(focus) } : undefined}
        />
      </button>
    )
  }

  function Accordion({
    sectionKey,
    title,
    onClear,
    children,
    isFirst
  }: {
    sectionKey: keyof typeof open
    title: string
    onClear?: () => void
    children: React.ReactNode
    isFirst?: boolean
  }) {
    const isOpen = open[sectionKey]
    return (
      <div className={[isFirst ? 'py-5' : 'border-t border-black/90 py-5'].join(' ')}>
        <button
          type="button"
          className="flex w-full items-center justify-between gap-4 text-[15px] uppercase tracking-wide"
          onClick={() => setOpen(s => ({ ...s, [sectionKey]: !s[sectionKey] }))}
          aria-expanded={isOpen}
        >
          <span className="min-w-0 truncate">{title}</span>
          <span className="flex shrink-0 items-center gap-4">
            {onClear && (
              <span
                className="text-sm uppercase text-black/60 hover:text-black hover:underline"
                onClick={(e) => {
                  e.stopPropagation()
                  onClear()
                }}
                role="button"
                tabIndex={0}
              >
                Clear
              </span>
            )}
            <PlusIcon className={`h-5 w-5 transition ${isOpen ? 'rotate-45' : ''}`} />
          </span>
        </button>

        {isOpen && <div className="pt-5">{children}</div>}
      </div>
    )
  }

  const modalTopText = useMemo(() => {
    if (luckyPhase === 'revealYes') return 'YOU GOT IT!'
    if (luckyPhase === 'revealNo') return 'BETTER LUCK NEXT TIME!'
    if (luckyPhase === 'enter' || luckyPhase === 'open' || luckyPhase === 'calibrate') return 'OPENING TODAY’S BLIND BOX…'
    return ''
  }, [luckyPhase])

  const showOpenBox =
    luckyPhase === 'open' || luckyPhase === 'revealNo' || luckyPhase === 'revealYes' || luckyLatchedOpen

  const isWin = luckyPhase === 'revealYes'

  return (
    <main className="min-h-screen bg-white text-black flex flex-col lg:h-screen lg:overflow-hidden">
      <style>{`
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { width: 0; height: 0; }

        @keyframes pop-in {
          0% { transform: translateY(18px) scale(0.98); opacity: 0; }
          100% { transform: translateY(0px) scale(1); opacity: 1; }
        }

        @keyframes slow-bounce {
          0%, 100% { transform: translateY(0%); }
          50% { transform: translateY(-14px); }
        }

        @keyframes doll-bounce {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-12px); }
        }

        .calibrateBounce { animation: slow-bounce 1400ms ease-in-out infinite; }

        .xfade {
          transition: opacity 360ms ease, transform 520ms ease;
          will-change: opacity, transform;
        }

        .winDoll { --win-scale: 0.96; }
        @media (max-width: 639px) { .winDoll { --win-scale: 1.08; } }
        @media (min-width: 1024px) { .winDoll { --win-scale: 0.92; } }
      `}</style>

      <header ref={headerRef} className="w-full px-4 sm:px-6 pt-8 pb-6 shrink-0">
        <div className="w-full flex justify-center lg:justify-start">
          <h1 className="text-2xl font-semibold uppercase tracking-[0.26em] text-center lg:text-left">
            BUILD-A-BUBU
          </h1>
        </div>
        {note && <p className="mt-3 text-center text-sm text-black/60 uppercase">{note}</p>}
      </header>

      {/* padding-inline aligned, gap-0 */}
      <div className="w-full px-3 sm:px-4 lg:px-6 sm:pb-8 pb-6 flex-1 min-h-0 lg:overflow-hidden">
        <div
          className="flex flex-col gap-0 lg:flex-row lg:gap-0 min-h-0 w-full max-w-full min-w-0 lg:overflow-visible"
          style={desktopBodyH ? ({ ['--desktop-body-h' as any]: `${desktopBodyH}px` }) : undefined}
        >
          <aside className="min-w-0 flex-1 flex flex-col items-center lg:w-1/2 lg:flex-none lg:shrink-0 lg:h-[var(--desktop-body-h)] lg:overflow-hidden">
            <div className="w-full max-w-[720px] lg:max-w-none lg:h-full lg:flex lg:flex-col lg:items-center">
              <div className="relative w-full aspect-square lg:flex-1 lg:aspect-auto lg:h-[82%] lg:max-h-[82%]">
                <button
                  type="button"
                  onClick={clearAll}
                  className="absolute left-3 top-3 z-10 text-sm uppercase text-black/60 hover:text-black hover:underline"
                >
                  Clear
                </button>

                {/* slightly smaller on >=1024 */}
                <div className="absolute inset-0 lg:pt-3">
                  <div className="absolute inset-0 lg:scale-[1.0] lg:origin-center lg:translate-y-[8px]">
                    <img src={src.base(state.baseId)} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                    {state.noseId && <img src={src.nose(state.noseId)} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />}
                    {state.eyesId && <img src={src.eyes(state.eyesId)} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />}
                    {state.accIds.map(id => (
                      <img key={id} src={src.acc(id)} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-6 w-full flex justify-center lg:mt-2">
                <div className="flex flex-col items-center gap-4 pb-6 lg:pb-0">
                  <div className="flex flex-wrap items-center justify-center gap-3 text-base uppercase tracking-wide">
                    <button
                      type="button"
                      onClick={onBuildForMe}
                      className="border border-black px-5 py-2 hover:bg-black hover:text-white transition uppercase whitespace-nowrap"
                    >
                      BUILD FOR ME
                    </button>

                    <div className="flex flex-nowrap items-center gap-3">
                      <button
                        type="button"
                        onClick={onLucky}
                        className="border border-black px-5 py-2 hover:bg-black hover:text-white transition uppercase whitespace-nowrap"
                      >
                        OPEN BLIND BOX
                      </button>

                      <button
                        type="button"
                        onClick={onDownload}
                        className="border border-black px-3 py-2 hover:bg-black hover:text-white transition inline-flex items-center whitespace-nowrap"
                        aria-label="Download PNG"
                        title="Download PNG"
                      >
                        <DownloadIcon className="h-6 w-6" />
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-black/70 select-none">
                    <input
                      type="checkbox"
                      checked={forceLuckyWin}
                      onChange={(e) => setForceLuckyWin(e.target.checked)}
                    />
                    Force lucky win (temporary)
                  </label>
                </div>
              </div>

              {/* lg footer lives under left column */}
              <footer className="hidden lg:block mt-auto w-full pt-3 pb-2 px-0">
                <div className="w-full text-sm text-black/70 text-left uppercase tracking-wide">
                  DESIGNED + CODED WITH ☺️ AND 🫶 BY{' '}
                  <a
                    href="https://sooimkang07.github.io/portfolio/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline hover:text-black"
                  >
                    SOOIM
                  </a>
                </div>
              </footer>
            </div>
          </aside>

          {/* right column fills edge */}
          <section className="min-w-0 flex-1 lg:w-1/2 lg:flex-none lg:h-[var(--desktop-body-h)] lg:overflow-hidden lg:pr-0">
            <div className="px-1 sm:px-2 lg:h-full lg:overflow-y-auto overflow-x-hidden lg:pr-6">
              <Accordion sectionKey="base" title="Base" isFirst>
                <div className="grid grid-cols-3 gap-6 sm:grid-cols-4">
                  {baseOptions.map(id => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setState(s => ({ ...s, baseId: id }))}
                      className="w-full"
                    >
                      <div
                        className={`relative aspect-square w-full overflow-hidden ring-1 ${
                          state.baseId === id ? 'ring-black' : 'ring-transparent hover:ring-black/20'
                        }`}
                      >
                        <img src={src.base(id)} alt={id} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
                      </div>
                    </button>
                  ))}
                </div>
              </Accordion>

              <Accordion sectionKey="nose" title="Nose" onClear={clearNose}>
                <div className="grid grid-cols-3 gap-6 sm:grid-cols-4">
                  {noseOptions.map(id => (
                    <Tile
                      key={id}
                      id={id}
                      imageSrc={src.nose(id)}
                      selected={state.noseId === id}
                      onClick={() => setState(s => ({ ...s, noseId: id }))}
                      mega
                      kind="nose"
                    />
                  ))}
                </div>
              </Accordion>

              <Accordion sectionKey="eyes" title="Eyes" onClear={clearEyes}>
                <div className="grid grid-cols-3 gap-6 sm:grid-cols-4">
                  {EYES.map(id => (
                    <Tile
                      key={id}
                      id={id}
                      imageSrc={src.eyes(id)}
                      selected={state.eyesId === id}
                      onClick={() => setState(s => ({ ...s, eyesId: id }))}
                      mega
                      kind="eyes"
                    />
                  ))}
                </div>
              </Accordion>

              <Accordion sectionKey="acc" title="Accessories" onClear={clearAcc}>
                <div className="grid grid-cols-3 gap-6 sm:grid-cols-4">
                  {ACC.map(id => (
                    <Tile
                      key={id}
                      id={id}
                      imageSrc={src.acc(id)}
                      selected={state.accIds.includes(id)}
                      onClick={() => toggleAcc(id)}
                      mega
                      kind="acc"
                    />
                  ))}
                </div>
              </Accordion>

              <div className="h-10" />
            </div>
          </section>
        </div>
      </div>

      {/* <lg footer */}
      <footer className="w-full px-4 sm:px-6 py-4 lg:hidden shrink-0">
        <div className="w-full text-sm text-black/70 text-center uppercase tracking-wide">
          DESIGNED + CODED WITH ☺️ AND 🫶 BY{' '}
          <a
            href="https://sooimkang07.github.io/portfolio/"
            target="_blank"
            rel="noreferrer"
            className="underline hover:text-black"
          >
            SOOIM
          </a>
        </div>
      </footer>

      {/* ✅ RESTORED BLIND BOX MODAL (this is what got removed) */}
      {luckyPhase !== 'idle' && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center"
          onClick={closeLucky}
          role="dialog"
          aria-modal="true"
        >
          <div className="absolute inset-0 bg-black/60" />

          <div
            className="relative w-[96vw] max-w-[720px] px-3 sm:px-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="relative mx-auto flex max-h-[86vh] min-h-[64vh] flex-col items-center justify-between text-white">
              <div className="w-full pt-2 text-center uppercase tracking-wide leading-none">
                <div className={`text-base sm:text-lg ${modalTopText ? '' : 'opacity-0'}`}>{modalTopText || '.'}</div>
              </div>

              <div className="relative w-full flex-1 min-h-0 flex items-center justify-center">
                <div
                  className="relative w-[min(560px,88vw)]"
                  style={{
                    paddingTop: 'clamp(84px, 14vh, 138px)',
                    paddingBottom: 'clamp(8px, 1.5vh, 18px)'
                  }}
                >
                  <div
                    className={[
                      'relative w-full',
                      luckyPhase === 'calibrate' ? 'calibrateBounce' : ''
                    ].join(' ')}
                    style={{
                      transform: isWin ? 'translateY(6px) scale(0.72)' : 'translateY(0px) scale(1)',
                      transformOrigin: 'bottom center',
                      transition: 'transform 520ms ease'
                    }}
                  >
                    <div className="relative w-full">
                      <img
                        src={src.ui('box-closed')}
                        alt="mystery box"
                        className="xfade h-auto w-full select-none"
                        draggable={false}
                        style={{
                          opacity: showOpenBox ? 0 : 1,
                          transform: showOpenBox ? 'translateY(6px) scale(0.995)' : 'translateY(0px) scale(1)',
                          animation: luckyPhase === 'enter' ? 'pop-in 900ms ease-out forwards' : undefined
                        }}
                      />
                      <img
                        src={src.ui('box-open')}
                        alt="mystery box open"
                        className="xfade pointer-events-none absolute inset-0 h-auto w-full select-none"
                        draggable={false}
                        style={{
                          opacity: showOpenBox ? 1 : 0,
                          transform: showOpenBox ? 'translateY(0px) scale(1)' : 'translateY(-6px) scale(1.005)'
                        }}
                      />
                    </div>

                    {isWin && (
                      <div
                        className="winDoll pointer-events-none absolute left-1/2 top-0 z-10 w-full"
                        style={{
                          transform: 'translate(-50%, -72%) scale(var(--win-scale))',
                          transformOrigin: 'bottom center'
                        }}
                      >
                        <div style={{ animation: 'doll-bounce 1200ms ease-in-out infinite' }}>
                          <img src={src.base(BASE_LUCKY)} alt="" className="absolute inset-0 w-full h-auto select-none" draggable={false} />
                          <img src={src.nose(NOSE_LUCKY)} alt="" className="absolute inset-0 w-full h-auto select-none" draggable={false} />
                          <div className="pt-[100%]" />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={closeLucky}
                className="w-full pb-2 text-center text-xs sm:text-sm uppercase text-white/70 hover:text-white transition"
              >
                Click anywhere to close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}