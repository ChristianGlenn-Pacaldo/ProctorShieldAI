import { passwordVisibilityModule } from "./password-visibility-fixture.ts";
import * as feature from "../../src/lib/power-arena-feature.ts";
import * as password from "../../src/lib/password-update.ts";

/** Test adapters read the actual policy. Legacy Arena suites opt in explicitly;
 * defense tests run the same production guards with the flag absent. */
export function defenseDependency(name: string): unknown {
  if (name === "@/components/password-visibility-button") return passwordVisibilityModule;
  if (["@/lib/power-arena-feature", "./power-arena-feature.ts", "./lib/power-arena-feature"].includes(name)) return feature;
  if (name === "@/components/power-arena-feature") return { usePowerArenaEnabled: feature.isPowerArenaEnabled };
  if (name === "@/lib/password-update") return password;
}
