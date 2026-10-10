import Image from "next/image";
import styles from "./brand-image.module.css";

/** Official artwork only; shield-shaped gameplay and status icons stay separate. */
export default function BrandImage({
  variant = "shield", width = 36, className = "", decorative = false, preload = false,
}: {
  variant?: "logo" | "shield";
  width?: number;
  className?: string;
  decorative?: boolean;
  preload?: boolean;
}) {
  const full = variant === "logo";
  return <Image
    src={`/images/proctorshieldai-${full ? "logo" : "shield"}-transparent.png`}
    alt={decorative ? "" : "ProctorShieldAI"}
    width={full ? 1015 : 541}
    height={full ? 807 : 622}
    sizes={`${width}px`}
    preload={preload}
    className={`${styles.image} ${className}`}
    style={{ width, maxWidth: "100%", height: "auto" }}
  />;
}
