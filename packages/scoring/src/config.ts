import { parseItApplicabilityConfig, type ItApplicabilityConfig } from "./applicability";
import type { ItDefinition } from "./definitions";
import raw from "../config/it-applicability-2025.json";
import it2025 from "../definitions/2025-it.json";

/**
 * The 2025 IT applicability config, validated strictly when this module loads:
 * a format mismatch (unknown key, missing field, unknown sheet pair) throws
 * here, at startup, instead of silently mapping nothing.
 */
export const itApplicability2025: ItApplicabilityConfig = parseItApplicabilityConfig(raw, it2025 as unknown as ItDefinition);
