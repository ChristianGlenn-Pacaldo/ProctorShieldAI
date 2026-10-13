import AuthThemeControl from "@/components/auth-theme-control";
import "./auth.css";
import "./auth-glass.css";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <div className="ps-auth ps-auth-glass"><AuthThemeControl />{children}</div>;
}
