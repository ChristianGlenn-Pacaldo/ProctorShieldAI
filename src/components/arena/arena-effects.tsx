"use client";

import { useId, type CSSProperties } from "react";
import styles from "./arena-effects.module.css";

export interface ArenaVisualEffect {
  type: "meteor" | "blizzard" | "earthquake" | "deflected";
  blockedPower?: "meteor" | "blizzard" | "earthquake";
}

// Decoration only. The parent supplies committed outcomes and owns its existing
// four-second feedback lifecycle; this component cannot mutate gameplay.
export function ArenaEffects({ effect, shieldArmed }: { effect: ArenaVisualEffect | null; shieldArmed: boolean }) {
  const id = useId().replace(/:/g, "");
  if (!effect && !shieldArmed) return null;
  const blocked = effect?.type === "deflected";
  const power = blocked ? effect?.blockedPower ?? "meteor" : effect?.type;
  const fire = `${id}-fire`, rock = `${id}-rock`;
  return (
    <div aria-hidden="true" data-arena-vfx={effect?.type ?? "armed"} className={`pointer-events-none ${styles.layer} ${power ? styles[power] : ""} ${blocked ? styles.blocked : ""}`}>
      {effect && <>
        <div className={styles.flash} />
        <div className={styles.shockwave} />
        <div className={styles.aftermath} />
        <div className={styles.shake}>
          {power === "meteor" && <svg className={styles.scene} viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice">
            <defs>
              <linearGradient id={fire} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#fb923c" stopOpacity="0" /><stop offset=".55" stopColor="#ef4444" /><stop offset=".85" stopColor="#fbbf24" /><stop offset="1" stopColor="#fff7cc" /></linearGradient>
              <radialGradient id={rock}><stop stopColor="#fdba74" /><stop offset=".5" stopColor="#c2410c" /><stop offset="1" stopColor="#451a03" /></radialGradient>
            </defs>
            <g className={styles.meteorFlight}>
              <path className={styles.flameTrail} d="M476 365 C396 284 278 152 211 -70 C328 131 404 136 523 321 L488 288 C454 213 418 113 398 1 C465 159 506 222 549 332 Z" fill={`url(#${fire})`} />
              <path d="M487 344 L453 318 471 288 511 277 548 303 562 339 534 368 500 379 476 365 Z" fill={`url(#${rock})`} stroke="#fb923c" strokeWidth="7" />
              <path d="M471 304 L506 321 499 349 534 368 M506 321 L548 303 M499 349 L476 365" stroke="#ffcf69" strokeWidth="5" fill="none" />
              <path d="M482 295 L499 306 483 312 Z M524 328 L546 330 531 344 Z" fill="#7c2d12" />
            </g>
          </svg>}
          {power === "blizzard" && <>
            <div className={styles.frost} />
            <svg className={styles.scene} viewBox="0 0 1000 700" preserveAspectRatio="none">
              <g className={styles.iceBurst} fill="#cffafe" stroke="#67e8f9" strokeWidth="2"><path d="M491 332 L455 260 473 319 Z M518 350 L584 304 545 355 Z M504 375 L535 450 489 399 Z M478 359 L393 381 456 344 Z M520 325 L539 272 538 321 Z" /></g>
              <g className={styles.wind} stroke="#a5f3fc" strokeWidth="3" fill="none"><path d="M-200 160 Q190 40 650 195 T1250 110 M-200 450 Q220 280 700 470 T1280 340 M-120 610 Q400 420 1150 620" /><path d="M-100 260 Q380 110 1080 280 M-90 560 Q300 350 1120 520" opacity=".4" /></g>
            </svg>
          </>}
          {power === "earthquake" && <svg className={`${styles.scene} ${styles.cracks}`} viewBox="0 0 1000 700" preserveAspectRatio="none">
            <g fill="none" stroke="#fbbf24" strokeWidth="3"><path d="M500 405 L432 469 453 500 329 563 303 641 178 700 M500 405 L608 466 591 504 697 578 732 700 M500 405 L525 350 476 298 515 235 M433 468 L345 458 289 400 M606 466 L688 451 749 393 M329 563 L215 535 120 573" /></g>
            <g fill="none" stroke="#451a03" strokeWidth="8" opacity=".8"><path d="M500 405 L499 451 534 497 476 580 486 700 M500 405 L620 390 652 336 806 280" /></g>
          </svg>}
          <div className={styles.particles}>
            {Array.from({ length: 28 }, (_, i) => <span key={i} className={styles.particle} style={{ "--i": i, "--x": `${((i * 37) % 100)}%`, "--dx": `${((i * 71) % 480) - 240}px`, "--dy": `${-80 - ((i * 59) % 280)}px`, "--delay": `${(i % 7) * 65}ms` } as CSSProperties} />)}
          </div>
        </div>
      </>}
      {(shieldArmed || blocked) && <div className={`${styles.barrier} ${blocked ? styles.consumed : styles.armed}`}>
        <svg viewBox="0 0 400 400" className={styles.shield}>
          <circle cx="200" cy="200" r="176" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray="22 8" />
          <path d="M200 54 L322 101 307 235 Q288 306 200 348 Q112 306 93 235 L78 101 Z" fill="currentColor" fillOpacity=".06" stroke="currentColor" strokeWidth="5" />
          <path className={styles.shieldCrack} d="M200 55 L177 128 223 174 169 213 217 278 200 346" fill="none" stroke="#ecfeff" strokeWidth="4" />
        </svg>
        {blocked && <span className={styles.blockLabel}>BLOCKED · 0 PTS LOST</span>}
      </div>}
    </div>
  );
}
