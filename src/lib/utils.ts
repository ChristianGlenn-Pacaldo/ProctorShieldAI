import { clsx, type ClassValue } from "clsx";

// Class composition required by the installed 21st.dev registry component.
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}
