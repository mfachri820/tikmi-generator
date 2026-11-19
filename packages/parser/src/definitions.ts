import type { ItDefinition, MrDefinition } from "@tikmi/scoring";
import b2 from "@tikmi/scoring/definitions/2025-mr-b2.json";
import b3 from "@tikmi/scoring/definitions/2025-mr-b3.json";
import it from "@tikmi/scoring/definitions/2025-it.json";
import type { Definitions } from "./parse";

/** The committed 2025 definitions, typed. */
export const definitions2025: Definitions = {
  mr: { 2: b2 as unknown as MrDefinition, 3: b3 as unknown as MrDefinition },
  it: it as unknown as ItDefinition,
};
