"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ArrowUpRight, Camera, LayoutGrid, Swords, X } from "lucide-react";
import styles from "./product-features.module.css";

const features = [
  { id: "quiz-management", index: "01", label: "TEACHER WORKSPACE", title: "Smart Quiz Management", icon: LayoutGrid,
    description: "Build quizzes, edit questions, and configure assessment settings in one teaching workspace.",
    preview: "Teacher quiz editor", alt: "ProctorShieldAI quiz editor showing sample questions and answer choices." },
  { id: "ai-proctoring", index: "02", label: "EVIDENCE WITH CONTEXT", title: "AI-Assisted Proctoring", icon: Camera,
    description: "Face and head-position monitoring helps flag events during enabled proctored attempts. Teachers review live status and supporting evidence.",
    preview: "Teacher Live Monitor", alt: "ProctorShieldAI Live Monitor showing sample student status and camera-pending placeholders, with no real webcam images." },
  { id: "power-arena", index: "03", label: "MULTIPLAYER QUIZZES", title: "Power Arena", icon: Swords,
    description: "Turn quizzes into a multiplayer battle with gameplay points, power-ups, and a live leaderboard.",
    preview: "Student Arena interface", alt: "ProctorShieldAI Battle Arsenal showing sample Meteor Strike, Earthquake and Blizzard Frost controls." },
];

function imageSource(id: string, theme: "light" | "dark", cropped = false) {
  const assetId = id === "power-arena" ? "power-arena-arsenal" : id;
  return `/images/features/${assetId}-${theme}${cropped ? "-crop" : ""}.webp`;
}

export default function ProductFeatures() {
  const [selected, setSelected] = useState<(typeof features)[number] | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (selected && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [selected]);

  const close = () => dialog.current?.close();

  return (
    <div className={styles.features}>
      <div className={styles.grid}>
        {features.map(({ icon: Icon, ...feature }) => (
          <article key={feature.id} className={styles.card} data-product-feature={feature.id}>
            <div className={styles.top}><span className={styles.index}>{feature.index}</span><Icon size={22} aria-hidden="true" /></div>
            <span className={styles.tag}>{feature.label}</span>
            <h3>{feature.title}</h3>
            <button type="button" className={styles.preview} onClick={() => setSelected({ ...feature, icon: Icon })}
              aria-label={`View preview of ${feature.title} interface`} aria-haspopup="dialog" aria-controls="product-interface-preview">
              <span className={styles.frame}>
                <Image className={styles.lightImage} src={imageSource(feature.id, "light", true)} width={1280} height={800}
                  alt={feature.alt} sizes="(max-width: 720px) calc(100vw - 76px), (max-width: 1100px) 42vw, 350px" loading="lazy" />
                <Image className={styles.darkImage} src={imageSource(feature.id, "dark", true)} width={1280} height={800}
                  alt={feature.alt} sizes="(max-width: 720px) calc(100vw - 76px), (max-width: 1100px) 42vw, 350px" loading="lazy" />
              </span>
              <span className={styles.previewAction}>View preview <ArrowUpRight size={15} aria-hidden="true" /></span>
            </button>
            <p className={styles.description}>{feature.description}</p>
            <p className={styles.caption}>{feature.preview} <span aria-hidden="true">·</span> Sample data</p>
          </article>
        ))}
      </div>
      <dialog ref={dialog} id="product-interface-preview" className={styles.dialog} aria-labelledby="product-preview-title"
        onClose={() => setSelected(null)} onClick={event => { if (event.target === event.currentTarget) close(); }}
        onKeyDown={event => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("button, a[href]"))
            .filter(element => element.getClientRects().length > 0);
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        {selected && <>
          <div className={styles.dialogHeader}><div><h2 id="product-preview-title">{selected.preview}</h2><p>Actual ProctorShieldAI interface with sample data.</p></div>
            <button type="button" className={styles.close} onClick={close} aria-label="Close interface preview"><X size={22} aria-hidden="true" /></button>
          </div>
          <div className={styles.dialogImage}>
            <Image className={styles.lightImage} src={imageSource(selected.id, "light")} width={1600} height={1200} alt={selected.alt} sizes="90vw" loading="eager" />
            <Image className={styles.darkImage} src={imageSource(selected.id, "dark")} width={1600} height={1200} alt={selected.alt} sizes="90vw" loading="eager" />
          </div>
          <div className={styles.dialogFooter}>
            <span>Product preview <span aria-hidden="true">·</span> Sample data</span>
            <a className={styles.lightImage} href={imageSource(selected.id, "light")} target="_blank" rel="noopener noreferrer">Open original image <ArrowUpRight size={16} aria-hidden="true" /></a>
            <a className={styles.darkImage} href={imageSource(selected.id, "dark")} target="_blank" rel="noopener noreferrer">Open original image <ArrowUpRight size={16} aria-hidden="true" /></a>
          </div>
        </>}
      </dialog>
    </div>
  );
}
