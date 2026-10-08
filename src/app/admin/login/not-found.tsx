import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import styles from "./not-found.module.css";

export default function NotFound() {
  return (
    <div className={styles.screen}>
      <div className={styles.grid} aria-hidden="true" />
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <Link href="/" className={styles.brand} aria-label="ProctorShieldAI home">
            <span className={styles.brandIcon}><ShieldCheck size={26} aria-hidden="true" /></span>
            <span>ProctorShield<span className={styles.brandAccent}>AI</span></span>
          </Link>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.content}>
          <p className={styles.badge}>404 <span aria-hidden="true">•</span> PAGE NOT FOUND</p>
          <h1 className={styles.heading}>This page could not be found.</h1>
          <p className={styles.description}>
            The page you&apos;re looking for may have been moved, removed, or is no longer available.
          </p>
          <nav className={styles.actions} aria-label="Page recovery">
            <Link href="/" className={`${styles.button} ${styles.primary}`}>
              <ArrowLeft size={18} aria-hidden="true" /> Back to Home
            </Link>
          </nav>
        </div>

        <div className={styles.visual} aria-hidden="true">
          <div className={styles.robotFrame}>
            <Image
              src="/images/proctorshield-404-robot.jpg"
              alt=""
              width={1376}
              height={768}
              sizes="(min-width: 1024px) 1200px, (min-width: 640px) 650px, 460px"
              loading="eager"
              className={styles.robotImage}
            />
          </div>
        </div>
      </main>

      <footer className={styles.footer}>
        <span>ProctorShieldAI</span>
        <span aria-hidden="true">•</span>
        <span>Academic Integrity Platform</span>
      </footer>
    </div>
  );
}
