import "@/styles/proctorshield-tokens.css";
import BrandedNotFound from "./admin/login/not-found";

// Error fallback can render without the normal root-layout stylesheet.
export default function NotFound() {
  return <BrandedNotFound />;
}
